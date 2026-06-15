// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

// ----------------------------------------------------------------------
// Middleware
// ----------------------------------------------------------------------
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // serve index.html

// ----------------------------------------------------------------------
// In-memory OTP store
//
// NOTE: This is fine for demos / small projects. For production, use a
// persistent + shared store like Redis (with TTL) or a database table,
// especially if you run multiple server instances.
// ----------------------------------------------------------------------
const otpStore = new Map();
// otpStore structure:
// key   -> email (lowercased)
// value -> { otpHash, expiresAt, attempts, verified }

const OTP_LENGTH = parseInt(process.env.OTP_LENGTH || '6', 10);
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '5', 10);
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

// ----------------------------------------------------------------------
// Mail transporter
// ----------------------------------------------------------------------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for others
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

/** Generate a numeric OTP of given length, e.g. "483920" */
function generateOTP(length = OTP_LENGTH) {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[crypto.randomInt(0, digits.length)];
  }
  return otp;
}

/** Hash the OTP before storing it (never store plain OTPs) */
function hashOTP(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

/** Basic email format validation */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Build and send the OTP email */
async function sendOTPEmail(toEmail, otp) {
  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: 'Your Email Verification Code',
    text: `Your verification code is ${otp}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <h2 style="color: #111827;">Verify your email</h2>
        <p style="color: #374151; font-size: 15px;">
          Use the code below to verify your email address. This code will expire in
          <strong>${OTP_EXPIRY_MINUTES} minutes</strong>.
        </p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; margin: 24px 0; color: #111827;">
          ${otp}
        </div>
        <p style="color: #6b7280; font-size: 13px;">
          If you did not request this code, you can safely ignore this email.
        </p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}

// ----------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------

/**
 * POST /api/send-otp
 * Body: { email: string }
 * Generates an OTP, stores its hash, and emails it to the user.
 */
app.post('/api/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'A valid email is required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = otpStore.get(normalizedEmail);

    // Simple resend cooldown to prevent spamming
    if (existing && existing.lastSentAt && Date.now() - existing.lastSentAt < RESEND_COOLDOWN_SECONDS * 1000) {
      const waitSeconds = Math.ceil(
        (RESEND_COOLDOWN_SECONDS * 1000 - (Date.now() - existing.lastSentAt)) / 1000
      );
      return res.status(429).json({
        success: false,
        message: `Please wait ${waitSeconds}s before requesting another OTP.`,
      });
    }

    const otp = generateOTP();
    const otpHash = hashOTP(otp);
    const expiresAt = Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000;

    otpStore.set(normalizedEmail, {
      otpHash,
      expiresAt,
      attempts: 0,
      verified: false,
      lastSentAt: Date.now(),
    });

    await sendOTPEmail(normalizedEmail, otp);

    return res.json({
      success: true,
      message: `OTP sent to ${normalizedEmail}. It will expire in ${OTP_EXPIRY_MINUTES} minutes.`,
    });
  } catch (err) {
    console.error('Error sending OTP:', err);
    return res.status(500).json({ success: false, message: 'Failed to send OTP. Please try again later.' });
  }
});

/**
 * POST /api/verify-otp
 * Body: { email: string, otp: string }
 * Verifies the OTP against the stored hash.
 */
app.post('/api/verify-otp', (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const record = otpStore.get(normalizedEmail);

    if (!record) {
      return res.status(400).json({ success: false, message: 'No OTP request found for this email. Please request a new OTP.' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(normalizedEmail);
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      otpStore.delete(normalizedEmail);
      return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Please request a new OTP.' });
    }

    const incomingHash = hashOTP(String(otp).trim());

    if (incomingHash !== record.otpHash) {
      record.attempts += 1;
      return res.status(400).json({
        success: false,
        message: `Incorrect OTP. ${MAX_ATTEMPTS - record.attempts} attempt(s) remaining.`,
      });
    }

    // Success - mark verified and remove from store (or keep flagged, your choice)
    otpStore.delete(normalizedEmail);

    return res.json({ success: true, message: 'Email verified successfully!' });
  } catch (err) {
    console.error('Error verifying OTP:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Fallback to serve the frontend for any other GET route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ----------------------------------------------------------------------
// Periodic cleanup of expired OTPs (every 5 minutes)
// ----------------------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const [email, record] of otpStore.entries()) {
    if (now > record.expiresAt) {
      otpStore.delete(email);
    }
  }
}, 5 * 60 * 1000);

// ----------------------------------------------------------------------
// Start server
// ----------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

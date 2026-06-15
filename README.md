# Email OTP Verification (Node.js + Express)

A simple, complete email verification system using One-Time Passwords (OTP).
Includes an Express backend (OTP generation, hashing, expiry, rate limiting)
and a clean HTML/CSS/JS frontend.

## Features

- Generates a random numeric OTP and emails it via Nodemailer
- OTPs are hashed (SHA-256) before being stored — never stored in plain text
- OTP expiry (default: 5 minutes)
- Max verification attempts (default: 5) before requiring a new OTP
- Resend cooldown (default: 60 seconds) to prevent spam
- Simple, responsive 3-step UI: enter email → enter code → success

## Project structure

```
otp-verification/
├── server.js          # Express backend
├── package.json
├── .env.example        # copy to .env and fill in your values
└── public/
    └── index.html       # frontend UI
```

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment variables**

   Copy `.env.example` to `.env` and fill in your SMTP credentials:

   ```bash
   cp .env.example .env
   ```

   For Gmail:
   - Enable 2-Factor Authentication on your Google account
   - Generate an "App Password" at https://myaccount.google.com/apppasswords
   - Use that app password as `SMTP_PASS` (not your regular Gmail password)

   You can also use other providers (SendGrid, Mailgun, Outlook, Amazon SES, etc.)
   by changing `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS` accordingly.

3. **Run the server**

   ```bash
   npm start
   ```

   Or for auto-reload during development:

   ```bash
   npm run dev
   ```

4. **Open the app**

   Visit `http://localhost:5000` in your browser. The Express server serves
   `public/index.html` directly, so frontend and backend run on the same port —
   no CORS issues by default.

## API Endpoints

### `POST /api/send-otp`
Sends a 6-digit OTP to the given email address.

**Request body:**
```json
{ "email": "user@example.com" }
```

**Response:**
```json
{ "success": true, "message": "OTP sent to user@example.com. It will expire in 5 minutes." }
```

### `POST /api/verify-otp`
Verifies the OTP entered by the user.

**Request body:**
```json
{ "email": "user@example.com", "otp": "123456" }
```

**Response (success):**
```json
{ "success": true, "message": "Email verified successfully!" }
```

**Response (failure):**
```json
{ "success": false, "message": "Incorrect OTP. 4 attempt(s) remaining." }
```

### `GET /api/health`
Simple health check endpoint, returns server status and timestamp.

## Production notes

- The current implementation stores OTPs **in memory** (`Map`). This works for
  single-instance demos but is lost on restart and won't work across multiple
  server instances. For production, replace `otpStore` with **Redis** (using
  `EX` for automatic expiry) or a database table with a `expires_at` column.
- Consider adding rate limiting per IP (e.g., using `express-rate-limit`) on
  top of the existing per-email cooldown to prevent abuse.
- Always serve this over **HTTPS** in production.
- Never log or expose the raw OTP server-side beyond the email send step.

## Customization

- Change OTP length / expiry / resend cooldown via `.env` (`OTP_LENGTH`,
  `OTP_EXPIRY_MINUTES`) or constants at the top of `server.js`.
- Customize the email template inside `sendOTPEmail()` in `server.js`.
- Update colors/branding in the `<style>` section of `public/index.html`.

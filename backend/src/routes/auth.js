/**
 * Auth Routes — /api/auth
 *
 * Register, login, verify-email, forgot-password, reset-password, me.
 *
 * Security patterns:
 * - bcrypt 10 rounds
 * - JWT 7-day tokens
 * - Brute-force lockout: 5 attempts per email per 15min → 429
 * - Email enumeration prevention: same 201 response whether email exists or not
 * - Password strength: 8+ chars, uppercase, lowercase, number, special char
 * - Admin auto-promotion: set ADMIN_EMAIL env var — that user gets is_admin=true on verify
 * - User approval workflow: status='pending' until admin approves (skip in test mode)
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../database/db.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { sendVerificationEmail, sendPasswordResetEmail, sendAdminNewUserEmail } from '../services/email.js';

const router = express.Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BCRYPT_ROUNDS = 10;
const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;

function validatePasswordStrength(password) {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return 'Password must contain at least one special character (!@#$%^&*)';
  return null;
}

// ─── Register ─────────────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await db.queryOne('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing) {
      // Prevent email enumeration — same response as success
      return res.status(201).json({ message: 'Registration successful. Check your email to verify your account.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const verificationToken = generateVerificationToken();

    // In test mode, auto-approve so tests don't need admin approval.
    const initialStatus = process.env.NODE_ENV === 'test' ? 'approved' : 'pending';

    const user = await db.queryOne(
      `INSERT INTO users (email, password_hash, name, status, email_verified, verification_token, verification_token_expires)
       VALUES ($1, $2, $3, $4, 0, $5, $6)
       RETURNING id, email, name`,
      [normalizedEmail, passwordHash, name.trim(), initialStatus, verificationToken, new Date(Date.now() + 24 * 60 * 60 * 1000)]
    );

    try {
      await sendVerificationEmail(user.email, user.name, verificationToken);
    } catch (err) {
      console.error('Failed to send verification email:', err);
    }

    res.status(201).json({ message: 'Registration successful. Check your email to verify your account.' });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── Verify Email ──────────────────────────────────────────────────────────────

router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Verification token required' });

    const user = await db.queryOne(
      `SELECT id, email, name, email_verified, verification_token_expires
       FROM users WHERE verification_token = $1`,
      [token]
    );

    if (!user) return res.status(400).json({ error: 'Invalid or expired verification link' });
    if (user.email_verified) return res.status(200).json({ message: 'Email already verified' });
    if (new Date(user.verification_token_expires) < new Date()) {
      return res.status(400).json({ error: 'Verification link has expired. Please register again.' });
    }

    // Auto-promote if this is the ADMIN_EMAIL account
    const isAdminEmail = process.env.ADMIN_EMAIL && user.email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();
    await db.query(
      `UPDATE users SET email_verified = 1, verification_token = NULL, verification_token_expires = NULL
       ${isAdminEmail ? ", status = 'active', is_admin = true" : ''}
       WHERE id = $1`,
      [user.id]
    );

    if (!isAdminEmail) {
      try {
        await sendAdminNewUserEmail(user.email, user.name);
      } catch (err) {
        console.error('Admin notification failed:', err);
      }
    }

    const updatedUser = await db.queryOne('SELECT id, email, name, is_admin, status FROM users WHERE id = $1', [user.id]);
    const jwtToken = generateToken(updatedUser);
    res.json({
      message: 'Email verified successfully',
      token: jwtToken,
      user: { id: updatedUser.id, email: updatedUser.email, name: updatedUser.name, status: updatedUser.status, is_admin: updatedUser.is_admin },
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Email verification failed' });
  }
});

// ─── Login ─────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const normalizedEmail = email.trim().toLowerCase();

    // Brute-force check
    const recentFailures = await db.queryOne(
      `SELECT COUNT(*) as count FROM failed_login_attempts
       WHERE email = $1 AND attempt_time > CURRENT_TIMESTAMP - INTERVAL '${LOCKOUT_WINDOW_MINUTES} minutes'`,
      [normalizedEmail]
    );
    if (parseInt(recentFailures.count, 10) >= LOCKOUT_ATTEMPTS) {
      return res.status(429).json({
        error: `Account temporarily locked due to too many failed login attempts. Please try again in ${LOCKOUT_WINDOW_MINUTES} minutes.`
      });
    }

    const user = await db.queryOne(
      'SELECT id, email, name, password_hash, status, email_verified, is_admin FROM users WHERE email = $1',
      [normalizedEmail]
    );

    const passwordMatch = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!user || !passwordMatch) {
      if (user) {
        await db.query(
          'INSERT INTO failed_login_attempts (email, ip_address) VALUES ($1, $2)',
          [normalizedEmail, req.ip || 'unknown']
        );
      }
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await db.query('DELETE FROM failed_login_attempts WHERE email = $1', [normalizedEmail]);

    if (!user.email_verified) {
      return res.status(403).json({ error: 'Please verify your email before logging in' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending approval' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ error: 'Account access denied' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── Forgot Password ───────────────────────────────────────────────────────────

router.post('/forgot-password', async (req, res) => {
  const GENERIC_RESPONSE = { message: 'If an account exists with that email, a reset link has been sent.' };
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await db.queryOne('SELECT id, name FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (!user) return res.json(GENERIC_RESPONSE);

    const resetToken = generateVerificationToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, resetToken, expires]
    );

    sendPasswordResetEmail(email, user.name, resetToken).catch(err =>
      console.error('Failed to send password reset email:', err)
    );

    res.json(GENERIC_RESPONSE);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.json(GENERIC_RESPONSE);
  }
});

// ─── Reset Password ────────────────────────────────────────────────────────────

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });

    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const resetRecord = await db.queryOne(
      `SELECT id, user_id, expires_at FROM password_reset_tokens WHERE token = $1 AND used_at IS NULL`,
      [token]
    );

    if (!resetRecord || new Date(resetRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, resetRecord.user_id]);
    await db.query('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1', [resetRecord.id]);

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ─── Me ───────────────────────────────────────────────────────────────────────

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await db.queryOne(
      'SELECT id, email, name, status, is_admin, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateVerificationToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 64 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default router;

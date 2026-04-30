/**
 * Email Service — {{PROJECT_NAME}}
 *
 * Transactional email via AWS SES using IAM role auth.
 * No API key needed — Lambda's execution role must have ses:SendEmail permission.
 * Lazy-load SES client (pitfall #62).
 *
 * Test mode: NODE_ENV=test → logs to console only, no real emails sent.
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

/** @type {SESClient|null} */
let _sesClient = null;

function getSESClient() {
  if (!_sesClient) {
    _sesClient = new SESClient({ region: '{{AWS_REGION}}' });
  }
  return _sesClient;
}

function getFrom() {
  return process.env.EMAIL_FROM || '{{PROJECT_NAME}} <noreply@{{DOMAIN}}>';
}

function getAppUrl() {
  return (process.env.APP_URL || 'https://{{DOMAIN}}').replace(/\/$/, '');
}

async function sendEmail(to, subject, html) {
  if (process.env.NODE_ENV === 'test') {
    console.log(`[EMAIL TEST] To: ${to} | Subject: ${subject}`);
    return { MessageId: 'test-mode' };
  }

  console.log(`[EMAIL] Sending: ${subject} → ${to}`);
  try {
    const result = await getSESClient().send(new SendEmailCommand({
      Source: getFrom(),
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    }));
    console.log(`[EMAIL] Sent: ${subject} → ${to} (${result.MessageId})`);
    return result;
  } catch (error) {
    console.error(`[EMAIL] Failed to send "${subject}" to ${to}:`, error.message || error);
    throw error;
  }
}

// ─── Verification Email ────────────────────────────────────────────────────────

export async function sendVerificationEmail(email, name, token) {
  const appUrl = getAppUrl();
  const verifyUrl = `${appUrl}/verify-email.html?token=${token}`;

  await sendEmail(
    email,
    'Verify your {{PROJECT_NAME}} email',
    `<p>Hi ${name || 'there'},</p>
     <p>Thanks for signing up for <strong>{{PROJECT_NAME}}</strong>. Click the button below to verify your email address.</p>
     <p><a href="${verifyUrl}" style="background:#1A1A2E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Verify Email</a></p>
     <p>This link expires in 24 hours.</p>
     <p>If you didn't sign up, you can safely ignore this email.</p>`
  );
}

// ─── Password Reset Email ──────────────────────────────────────────────────────

export async function sendPasswordResetEmail(email, name, token) {
  const appUrl = getAppUrl();
  const resetUrl = `${appUrl}/reset-password.html?token=${token}`;

  await sendEmail(
    email,
    'Reset your {{PROJECT_NAME}} password',
    `<p>Hi ${name || 'there'},</p>
     <p>You requested a password reset. Click the button below to set a new password.</p>
     <p><a href="${resetUrl}" style="background:#1A1A2E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Reset Password</a></p>
     <p>This link expires in 1 hour. If you didn't request this, you can safely ignore it.</p>`
  );
}

// ─── Admin New User Notification ───────────────────────────────────────────────

export async function sendAdminNewUserEmail(userEmail, userName) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_FROM;
  if (!adminEmail) return;

  const appUrl = getAppUrl();
  await sendEmail(
    adminEmail,
    `New user pending approval: ${userEmail}`,
    `<p>A new user has verified their email and is pending approval:</p>
     <ul>
       <li><strong>Name:</strong> ${userName || 'Unknown'}</li>
       <li><strong>Email:</strong> ${userEmail}</li>
     </ul>
     <p><a href="${appUrl}/admin.html" style="background:#1A1A2E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Review in Admin Panel</a></p>`
  );
}

// ─── Add more email functions here ────────────────────────────────────────────
// Remember pitfall #124: every email with an action link needs an E2E test.

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import { db } from '../src/database/db.js';

const TEST_EMAIL = 'auth-test@{{PROJECT_SLUG}}-test.com';
const TEST_PASSWORD = 'TestPassword123!';
const TEST_NAME = 'Auth Test User';

let verificationToken = null;
let authToken = null;
let userId = null;

beforeAll(async () => {
  // Clean up first (pitfall #12)
  const existing = await db.queryOne('SELECT id FROM users WHERE email = $1', [TEST_EMAIL]);
  if (existing) {
    await db.query('DELETE FROM failed_login_attempts WHERE email = $1', [TEST_EMAIL]);
    await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [existing.id]);
    await db.query('DELETE FROM users WHERE id = $1', [existing.id]);
  }
});

describe('POST /api/auth/register', () => {
  it('registers a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME });

    expect(res.status).toBe(201);
    expect(res.body.message).toBeDefined();

    const user = await db.queryOne(
      'SELECT id, verification_token FROM users WHERE email = $1',
      [TEST_EMAIL]
    );
    expect(user).not.toBeNull();
    userId = user.id;
    verificationToken = user.verification_token;
    expect(verificationToken).toBeTruthy();
  });

  it('rejects duplicate email with enumeration-safe 201 response', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME });
    expect(res.status).toBe(201);
  });

  it('rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL });
    expect(res.status).toBe(400);
  });

  it('rejects weak password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'other@test.com', password: '123', name: 'Test' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/verify-email', () => {
  it('rejects invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'bad-token-value' });
    expect(res.status).toBe(400);
  });

  it('verifies email with valid token', async () => {
    expect(verificationToken).toBeTruthy();
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: verificationToken });
    expect(res.status).toBe(200);
    // email_verified is SMALLINT — check for 1, not true (pitfall #104)
    const user = await db.queryOne('SELECT email_verified FROM users WHERE id = $1', [userId]);
    expect(user.email_verified).toBe(1);
  });

  it('rejects reuse of token', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: verificationToken });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('logs in successfully after email verified', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    authToken = res.body.token;
  });

  it('does not enumerate emails (same error for unknown email)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@doesnotexist.com', password: 'pass' });
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('registered');
  });
});

describe('GET /api/auth/me', () => {
  it('returns user data with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(TEST_EMAIL);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('returns 200 for unknown email (enumeration safe)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@doesnotexist.com' });
    expect(res.status).toBe(200);
  });

  it('returns 200 for known email', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: TEST_EMAIL });
    expect(res.status).toBe(200);
  });
});

describe('Brute-force lockout', () => {
  const LOCKOUT_EMAIL = 'lockout-test@{{PROJECT_SLUG}}-test.com';
  const LOCKOUT_PASSWORD = 'Correct123!';

  beforeAll(async () => {
    const user = await db.queryOne('SELECT id FROM users WHERE email = $1', [LOCKOUT_EMAIL]);
    if (user) {
      await db.query('DELETE FROM failed_login_attempts WHERE email = $1', [LOCKOUT_EMAIL]);
      await db.query('DELETE FROM users WHERE id = $1', [user.id]);
    } else {
      await db.query('DELETE FROM failed_login_attempts WHERE email = $1', [LOCKOUT_EMAIL]);
    }
    await request(app).post('/api/auth/register').send({ email: LOCKOUT_EMAIL, password: LOCKOUT_PASSWORD, name: 'Lockout Test' });
  });

  it('locks out after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ email: LOCKOUT_EMAIL, password: 'Wrong1!' });
    }
    const res = await request(app).post('/api/auth/login').send({ email: LOCKOUT_EMAIL, password: 'Wrong1!' });
    expect(res.status).toBe(429);
  });

  it('respects lockout window — rejects even correct password during lockout', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: LOCKOUT_EMAIL, password: LOCKOUT_PASSWORD });
    expect(res.status).toBe(429);
  });

  it('allows login after lockout expires (time-travel technique — pitfall #68)', async () => {
    await db.query(
      "UPDATE failed_login_attempts SET attempt_time = CURRENT_TIMESTAMP - INTERVAL '20 minutes' WHERE email = $1",
      [LOCKOUT_EMAIL]
    );
    const user = await db.queryOne('SELECT verification_token FROM users WHERE email = $1', [LOCKOUT_EMAIL]);
    if (user?.verification_token) {
      await request(app).post('/api/auth/verify-email').send({ token: user.verification_token });
    }
    const res = await request(app).post('/api/auth/login').send({ email: LOCKOUT_EMAIL, password: LOCKOUT_PASSWORD });
    expect([200, 403]).toContain(res.status);
  });
});

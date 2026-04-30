/**
 * Security Tests — OWASP Top 10
 *
 * Adapt these tests to your routes. The cross-user isolation tests
 * assume you have a /api/trips-style resource — replace with your own.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import { db } from '../src/database/db.js';

const EMAIL_A = 'sec-a@{{PROJECT_SLUG}}-test.com';
const EMAIL_B = 'sec-b@{{PROJECT_SLUG}}-test.com';
const PASSWORD = 'Security123!';

let tokenA = null;
let tokenB = null;

beforeAll(async () => {
  for (const email of [EMAIL_A, EMAIL_B]) {
    const existing = await db.queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) {
      await db.query('DELETE FROM failed_login_attempts WHERE email = $1', [email]);
      await db.query('DELETE FROM users WHERE id = $1', [existing.id]);
    }
  }

  // Setup users A and B
  for (const [email, name] of [[EMAIL_A, 'Security A'], [EMAIL_B, 'Security B']]) {
    await request(app).post('/api/auth/register').send({ email, password: PASSWORD, name });
    const u = await db.queryOne('SELECT id, verification_token FROM users WHERE email = $1', [email]);
    await request(app).post('/api/auth/verify-email').send({ token: u.verification_token });
    const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    if (email === EMAIL_A) tokenA = login.body.token;
    if (email === EMAIL_B) tokenB = login.body.token;
  }
});

describe('SQL Injection Detection (OWASP A03)', () => {
  const injectionPayloads = [
    "' OR '1'='1",
    "1; DROP TABLE users;",
    "' UNION SELECT * FROM users--",
    "admin'--",
  ];

  for (const payload of injectionPayloads) {
    it(`rejects SQL injection in email: ${payload.slice(0, 30)}`, async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: payload, password: 'pass' });
      expect(res.status).toBe(400);
    });
  }
});

describe('XSS Detection (OWASP A03)', () => {
  it('rejects XSS payload in auth fields', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: '<script>alert(1)</script>@test.com', password: 'pass' });
    expect([400, 401]).toContain(res.status);
  });
});

describe('Authentication (OWASP A07)', () => {
  it('rejects tampered JWT', async () => {
    const parts = tokenA.split('.');
    const tampered = parts[0] + '.' + parts[1] + '.TAMPERED_SIG';
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  it('rejects expired/invalid JWT', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0In0.invalid');
    expect(res.status).toBe(401);
  });
});

describe('Error response safety (OWASP A05)', () => {
  it('health check returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Brute-force protection (OWASP A07)', () => {
  const BF_EMAIL = 'brute-sec@{{PROJECT_SLUG}}-test.com';
  const BF_PASSWORD = 'Correct123!';

  beforeAll(async () => {
    await db.query('DELETE FROM failed_login_attempts WHERE email = $1', [BF_EMAIL]);
    const u = await db.queryOne('SELECT id FROM users WHERE email = $1', [BF_EMAIL]);
    if (u) await db.query('DELETE FROM users WHERE id = $1', [u.id]);
    await request(app).post('/api/auth/register').send({ email: BF_EMAIL, password: BF_PASSWORD, name: 'BF Test' });
  });

  it('enforces lockout after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ email: BF_EMAIL, password: 'Wrong1!' });
    }
    const res = await request(app).post('/api/auth/login').send({ email: BF_EMAIL, password: 'Wrong1!' });
    expect(res.status).toBe(429);
  });

  it('sliding window resets when attempts age out (time-travel — pitfall #68)', async () => {
    await db.query(
      "UPDATE failed_login_attempts SET attempt_time = CURRENT_TIMESTAMP - INTERVAL '20 minutes' WHERE email = $1",
      [BF_EMAIL]
    );
    const res = await request(app).post('/api/auth/login').send({ email: BF_EMAIL, password: 'Wrong1!' });
    expect(res.status).toBe(401); // 401 (auth fail), not 429 (lockout)
  });
});

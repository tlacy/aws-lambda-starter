#!/usr/bin/env node
/**
 * Smoke Tests — run against a live API endpoint
 *
 * Usage:
 *   node smoke-test.mjs https://staging.execute-api.us-east-1.amazonaws.com
 *   node smoke-test.mjs https://prod.execute-api.us-east-1.amazonaws.com
 *
 * Add a new test for every new API endpoint (pitfall #98).
 */

const BASE_URL = process.argv[2];
if (!BASE_URL) {
  console.error('Usage: node smoke-test.mjs <base-url>');
  process.exit(1);
}

const TEST_EMAIL = `smoke-${Date.now()}@test-{{PROJECT_SLUG}}.com`;
const TEST_PASSWORD = 'SmokeTest@2026!';

async function req(method, path, body = null, token = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    process.exit(1);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log(`\nSmoke tests → ${BASE_URL}\n`);

  await test('Health check', async () => {
    const { status, data } = await req('GET', '/health');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.status === 'ok', `Expected status=ok, got ${JSON.stringify(data)}`);
  });

  await test('User registration', async () => {
    const { status, data } = await req('POST', '/api/auth/register', {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      name: 'Smoke Test User',
    });
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
  });

  await test('Login blocked before email verification', async () => {
    const { status } = await req('POST', '/api/auth/login', {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    assert(status === 401 || status === 403, `Expected 401/403 before verification, got ${status}`);
  });

  await test('Protected route /api/auth/me requires auth', async () => {
    const { status } = await req('GET', '/api/auth/me');
    assert(status === 401, `Expected 401, got ${status}`);
  });

  await test('Forgot password returns 200 (email enumeration safe)', async () => {
    const { status } = await req('POST', '/api/auth/forgot-password', {
      email: 'nonexistent@test.com',
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // ── Add your app-specific smoke tests below ─────────────────────────────
  // Example: protected route requires auth
  // await test('GET /api/trips requires auth', async () => {
  //   const { status } = await req('GET', '/api/trips');
  //   assert(status === 401, `Expected 401, got ${status}`);
  // });

  console.log('\n✅ All smoke tests passed\n');
}

main().catch(err => {
  console.error('Smoke test error:', err);
  process.exit(1);
});

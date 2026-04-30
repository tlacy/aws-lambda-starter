// tests/setup.js
// Guard: do NOT override NODE_ENV to 'test' if LIVE_AI is set (pitfall #104)
if (process.env.LIVE_AI !== 'true') {
  process.env.NODE_ENV = 'test';
}

import { afterAll } from '@jest/globals';
import { db } from '../src/database/db.js';

afterAll(async () => {
  await db.close();
});

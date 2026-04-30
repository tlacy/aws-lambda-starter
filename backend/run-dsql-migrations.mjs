#!/usr/bin/env node
/**
 * DSQL Migration Runner
 *
 * Applies SQL migration files to a DSQL cluster using admin auth token.
 * Uses psql for execution so all DDL statements run in one session (pitfall #102).
 *
 * Usage:
 *   node run-dsql-migrations.mjs --cluster <hostname>          # Run pending migrations
 *   node run-dsql-migrations.mjs --cluster <hostname> --setup  # Create all tables fresh
 *
 * Admin token requires: aws dsql generate-db-connect-admin-auth-token
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'database', 'migrations');
const REGION = process.env.AWS_REGION || 'us-east-1';

// Add new migration files here as you create them
const migrations = [
  '000_initial_schema.sql',
];

function generateAdminToken(clusterHostname) {
  const cmd = `aws dsql generate-db-connect-admin-auth-token --hostname ${clusterHostname} --region ${REGION} --output text`;
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

async function getAppliedMigrations(client) {
  try {
    const result = await client.query('SELECT filename FROM migrations ORDER BY applied_at');
    return result.rows.map(r => r.filename);
  } catch {
    // migrations table may not exist yet
    return [];
  }
}

async function markMigrationApplied(client, filename) {
  await client.query(
    "INSERT INTO migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
    [filename]
  );
}

async function runMigrationFile(filename, hostname, token) {
  const filePath = join(MIGRATIONS_DIR, filename);
  if (!existsSync(filePath)) {
    throw new Error(`Migration file not found: ${filePath}`);
  }

  console.log(`[migrate] Running ${filename} via psql...`);

  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PGPASSWORD: token,
      PGSSLMODE: 'require',
    };

    const proc = spawn('psql', [
      '-h', hostname,
      '-p', '5432',
      '-U', 'admin',
      '-d', 'postgres',
      '-f', filePath,
      '--no-password',
    ], { env, stdio: ['inherit', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; process.stdout.write(d); });
    proc.stderr.on('data', d => { stderr += d; process.stderr.write(d); });

    proc.on('close', code => {
      if (code === 0) {
        console.log(`[migrate] ✅ ${filename} complete`);
        resolve();
      } else {
        reject(new Error(`psql exited ${code}\n${stderr}`));
      }
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const clusterIdx = args.indexOf('--cluster');
  const isSetup = args.includes('--setup');

  if (clusterIdx === -1 || !args[clusterIdx + 1]) {
    console.error('Usage: node run-dsql-migrations.mjs --cluster <hostname> [--setup]');
    process.exit(1);
  }

  const hostname = args[clusterIdx + 1];
  console.log(`[migrate] Target: ${hostname}`);

  const token = generateAdminToken(hostname);
  console.log('[migrate] Admin token generated');

  if (isSetup) {
    console.log('[migrate] Running full setup (000_initial_schema.sql)');
    await runMigrationFile('000_initial_schema.sql', hostname, token);
    console.log('[migrate] ✅ Setup complete');
    return;
  }

  // Connect to check applied migrations
  const client = new pg.Client({
    host: hostname,
    port: 5432,
    user: 'admin',
    password: token,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const applied = await getAppliedMigrations(client);
  const pending = migrations.filter(m => !applied.includes(m));

  if (pending.length === 0) {
    console.log('[migrate] ✅ No pending migrations');
    await client.end();
    return;
  }

  console.log(`[migrate] ${pending.length} pending migration(s): ${pending.join(', ')}`);

  for (const filename of pending) {
    await runMigrationFile(filename, hostname, token);
    await markMigrationApplied(client, filename);
  }

  await client.end();
  console.log('[migrate] ✅ All migrations applied');
}

main().catch(err => {
  console.error('[migrate] ❌', err.message);
  process.exit(1);
});

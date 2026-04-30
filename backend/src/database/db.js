/**
 * Database Connection — Aurora DSQL only (all environments)
 *
 * DSQL-only policy: no local PostgreSQL fallback anywhere.
 * Dev/test connect to the staging DSQL cluster using admin token.
 * Production connects using the Lambda IAM role token.
 *
 * Token auto-refreshes 3 minutes before the 15-minute expiry.
 */

import pg from 'pg';
import { generateDSQLAuthToken } from '../utils/dsql-auth.js';
import { getSecrets } from '../config/secrets.js';

const { Client } = pg;

let dbConnection = null;
let tokenExpiry = null;
const TOKEN_REFRESH_MARGIN = 3 * 60 * 1000;

function needsTokenRefresh() {
  if (!tokenExpiry) return true;
  return Date.now() >= tokenExpiry - TOKEN_REFRESH_MARGIN;
}

async function closeConnection() {
  if (dbConnection) {
    try { await dbConnection.end(); } catch {}
    dbConnection = null;
    tokenExpiry = null;
  }
}

async function getConnection() {
  if (needsTokenRefresh()) {
    console.log('🔄 DSQL token expiring — refreshing connection...');
    await closeConnection();
  }
  if (dbConnection) return dbConnection;

  const secrets = await getSecrets();
  const endpoint = secrets.DSQL_ENDPOINT.split(':')[0];
  const env = process.env.NODE_ENV || 'development';

  // Production: Lambda IAM role.  Dev/test: admin role (full DDL for migrations).
  const dbUser = env === 'production'
    ? (process.env.IAM_ROLE_NAME || '{{LAMBDA_IAM_ROLE}}')
    : 'admin';

  const token = await generateDSQLAuthToken(dbUser);

  const client = new Client({
    host: endpoint,
    port: 5432,
    database: 'postgres',
    user: dbUser,
    password: token,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  dbConnection = client;
  tokenExpiry = Date.now() + 15 * 60 * 1000;
  console.log(`✅ DSQL connected (${env}) as "${dbUser}"`);
  return client;
}

const db = {
  async query(text, params) {
    const client = await getConnection();
    return client.query(text, params);
  },

  async queryOne(text, params) {
    const result = await this.query(text, params);
    return result.rows[0] || null;
  },

  async queryRows(text, params) {
    const result = await this.query(text, params);
    return result.rows;
  },

  async close() {
    await closeConnection();
  },
};

export default db;
export { db };

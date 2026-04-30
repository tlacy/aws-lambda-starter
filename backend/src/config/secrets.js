/**
 * AWS Secrets Manager Integration
 *
 * Retrieves all app secrets from AWS Secrets Manager.
 * Caches after first retrieval to minimize API calls (warm starts reuse cache).
 * Lazy-loaded — never call at module level (Lambda cold start ordering).
 *
 * Secret names:
 *   production : {{PROJECT_SLUG}}/production
 *   staging    : {{PROJECT_SLUG}}/staging
 *
 * Required keys in each secret:
 *   DSQL_ENDPOINT, JWT_SECRET, EMAIL_FROM, APP_URL, API_URL
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

let secretsCache = null;

export async function getSecrets() {
  if (secretsCache) return secretsCache;

  const env = process.env.NODE_ENV || 'development';

  if (env !== 'production') {
    // Dev/test: read from .env (loaded by dotenv in server.js / tests)
    secretsCache = {
      DSQL_ENDPOINT: process.env.DSQL_ENDPOINT   || '',
      JWT_SECRET:    process.env.JWT_SECRET       || 'dev-jwt-secret-change-in-prod',
      EMAIL_FROM:    process.env.EMAIL_FROM        || '{{PROJECT_NAME}} <noreply@{{DOMAIN}}>',
      APP_URL:       process.env.APP_URL           || 'http://localhost:8080',
      API_URL:       process.env.API_URL           || 'http://localhost:3000',
    };
    return secretsCache;
  }

  // Production + staging: AWS Secrets Manager
  const secretName = process.env.SECRETS_NAME || '{{PROJECT_SLUG}}/production';
  const client = new SecretsManagerClient({ region: '{{AWS_REGION}}' });

  try {
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
    secretsCache = JSON.parse(response.SecretString);
    return secretsCache;
  } catch (error) {
    console.error('Failed to retrieve secrets from Secrets Manager:', error);
    throw new Error('Failed to retrieve production secrets');
  }
}

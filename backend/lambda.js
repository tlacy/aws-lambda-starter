/**
 * Lambda entry point — wraps Express app with @vendia/serverless-express.
 *
 * On cold start:
 * 1. Loads secrets from AWS Secrets Manager → injects into process.env
 * 2. Express app is initialized once and reused across warm invocations
 *
 * Pitfall #62: secrets and services are lazy-loaded here, never at module level
 * Pitfall #81: update-function-configuration replaces ALL env vars — always include NODE_ENV=production
 * Pitfall #83: always `aws lambda wait function-updated` + `sleep 3` between update-function-code and update-function-configuration
 */

import serverlessExpress from '@vendia/serverless-express';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

let serverlessApp = null;

async function loadSecrets() {
  const secretName = process.env.SECRETS_NAME || '{{PROJECT_SLUG}}/production';
  const region = process.env.AWS_REGION || '{{AWS_REGION}}';

  const client = new SecretsManagerClient({ region });
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await client.send(command);
  const secrets = JSON.parse(response.SecretString);

  for (const [key, value] of Object.entries(secrets)) {
    process.env[key] = value;
  }

  console.log('[lambda] Secrets loaded from:', secretName);
}

async function getApp() {
  if (serverlessApp) return serverlessApp;

  console.log('[lambda] Cold start — loading secrets');
  await loadSecrets();

  const { default: app } = await import('./src/app.js');
  serverlessApp = serverlessExpress({ app });
  return serverlessApp;
}

export const handler = async (event, context) => {
  const app = await getApp();
  return app(event, context);
};

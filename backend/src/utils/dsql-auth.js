/**
 * Aurora DSQL IAM Authentication
 *
 * Generates temporary SigV4-presigned auth tokens for DSQL connections.
 * Tokens are valid for 15 minutes.
 *
 * CRITICAL: use signer.presign() NOT signer.sign() — pitfall #26.
 * Token format: hostname/path?query  (NO protocol, NO port)
 */

import { SignatureV4 } from '@aws-sdk/signature-v4';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Sha256 } from '@aws-crypto/sha256-js';
import { getSecrets } from '../config/secrets.js';

export async function generateDSQLAuthToken(dbUser) {
  const secrets = await getSecrets();
  if (!secrets?.DSQL_ENDPOINT) throw new Error('Missing DSQL_ENDPOINT secret');

  const endpoint = secrets.DSQL_ENDPOINT.split(':')[0];
  const region = process.env.AWS_REGION || '{{AWS_REGION}}';

  let credentials;
  if (process.env.AWS_EXECUTION_ENV || process.env.NODE_ENV === 'production') {
    // Lambda: use injected environment credentials
    credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    };
  } else {
    // Local: use ~/.aws credentials
    credentials = await defaultProvider()();
  }

  const signer = new SignatureV4({
    service: 'dsql',
    region,
    credentials,
    sha256: Sha256,
  });

  const isAdmin = dbUser === 'admin';
  const action = isAdmin ? 'DbConnectAdmin' : 'DbConnect';

  const request = new HttpRequest({
    method: 'GET',
    protocol: 'https:',
    hostname: endpoint,
    path: '/',
    query: { Action: action },
    headers: { host: endpoint },
  });

  const presigned = await signer.presign(request, { expiresIn: 900 });

  const queryParams = Object.entries(presigned.query || {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);

  return `${presigned.hostname}${presigned.path}?${queryParams.join('&')}`;
}

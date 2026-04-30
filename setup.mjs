#!/usr/bin/env node
/**
 * New Project Setup Script
 *
 * Replaces all {{PLACEHOLDER}} values in the template with your project-specific values.
 * Run once after cloning: node setup.mjs
 *
 * After running: review all changed files, then delete this script.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import readline from 'readline';

const PLACEHOLDER_FILES = [
  '.github/copilot-instructions.md',
  'docs/AGENT_STATE.md',
  'QUICK_START.md',
  'SETUP.md',
  'README.md',
  'backend/deploy.sh',
  'deploy-frontend.sh',
  'backend/src/app.js',
  'backend/src/services/email.js',
  'backend/src/config/secrets.js',
  'backend/smoke-test.mjs',
  'database/migrations/000_initial_schema.sql',
];

const PLACEHOLDERS = {
  '{{PROJECT_NAME}}':           { prompt: 'Project name (e.g. "MyApp")',                              example: 'MyApp' },
  '{{PROJECT_SLUG}}':           { prompt: 'Project slug for Secrets Manager (e.g. "myapp")',           example: 'myapp' },
  '{{PROJECT_DESCRIPTION}}':    { prompt: 'One-line project description',                              example: 'AI-powered travel planner' },
  '{{DOMAIN}}':                 { prompt: 'Production domain (e.g. "www.myapp.com")',                  example: 'www.myapp.com' },
  '{{AWS_ACCOUNT_ID}}':         { prompt: 'AWS Account ID (12 digits)',                                example: '123456789012' },
  '{{AWS_REGION}}':             { prompt: 'AWS Region (default: us-east-1)',                           example: 'us-east-1' },
  '{{PROD_LAMBDA}}':            { prompt: 'Production Lambda function name',                           example: 'myapp-api' },
  '{{STAGING_LAMBDA}}':         { prompt: 'Staging Lambda function name',                             example: 'myapp-api-staging' },
  '{{PROD_API_GATEWAY_ID}}':    { prompt: 'Production API Gateway ID (e.g. "v9p24h7ua5")',            example: 'v9p24h7ua5' },
  '{{STAGING_API_GATEWAY_ID}}': { prompt: 'Staging API Gateway ID',                                   example: 'itx4u290a2' },
  '{{PROD_DSQL_ENDPOINT}}':     { prompt: 'Production DSQL endpoint hostname',                        example: 'abc123.dsql.us-east-1.on.aws' },
  '{{STAGING_DSQL_ENDPOINT}}':  { prompt: 'Staging DSQL endpoint hostname',                           example: 'xyz789.dsql.us-east-1.on.aws' },
  '{{LAMBDA_IAM_ROLE}}':        { prompt: 'Lambda IAM role name (NOT ARN)',                           example: 'myapp-lambda-role' },
  '{{S3_BUCKET}}':              { prompt: 'S3 bucket name for deployments',                           example: 'myapp-assets' },
  '{{CLOUDFRONT_DIST_ID}}':     { prompt: 'CloudFront distribution ID (or leave blank)',              example: 'ABCDEF123456' },
  '{{ACM_CERT_ARN}}':           { prompt: 'ACM certificate ARN (or leave blank)',                     example: 'arn:aws:acm:...' },
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n🚀 aws-lambda-starter setup\n');
  console.log('Answer the prompts below. Press Enter to accept the example value.\n');

  const values = {};

  for (const [placeholder, { prompt, example }] of Object.entries(PLACEHOLDERS)) {
    const answer = await ask(`${prompt}\n  [${example}]: `);
    values[placeholder] = answer.trim() || example;
  }

  rl.close();

  console.log('\n📝 Replacing placeholders...\n');

  for (const file of PLACEHOLDER_FILES) {
    try {
      let content = readFileSync(file, 'utf8');
      let changed = false;
      for (const [placeholder, value] of Object.entries(values)) {
        if (content.includes(placeholder)) {
          content = content.replaceAll(placeholder, value);
          changed = true;
        }
      }
      if (changed) {
        writeFileSync(file, content);
        console.log(`  ✅ ${file}`);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`  ⚠️  ${file}: ${err.message}`);
    }
  }

  console.log('\n✅ Setup complete!\n');
  console.log('Next steps:');
  console.log('  1. Review the changed files');
  console.log('  2. Update backend/src/services/email.js with project-specific email templates');
  console.log('  3. Update backend/src/app.js CORS origins with your domain');
  console.log('  4. Follow SETUP.md for AWS infrastructure setup');
  console.log('  5. Delete this setup.mjs file');
  console.log('  6. git add . && git commit -m "Initial project setup"\n');
}

main().catch(err => { console.error(err); process.exit(1); });

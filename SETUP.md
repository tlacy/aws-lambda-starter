# {{PROJECT_NAME}} — AWS Infrastructure Setup

Run this once when creating a new project from the template.

## Prerequisites

- AWS CLI configured (`aws configure`)
- `gh` CLI authenticated (`gh auth login`)
- Node.js 24.x
- psql installed (`brew install libpq`)

---

## Step 1: Fill in placeholders

```bash
node setup.mjs
```

Answer all prompts. This replaces `{{PLACEHOLDER}}` values across all config files.

---

## Step 2: Create IAM role for Lambda

```bash
# Create role with Lambda trust policy
aws iam create-role \
  --role-name {{LAMBDA_IAM_ROLE}} \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach basic Lambda execution policy
aws iam attach-role-policy \
  --role-name {{LAMBDA_IAM_ROLE}} \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Attach Secrets Manager read access
aws iam put-role-policy \
  --role-name {{LAMBDA_IAM_ROLE}} \
  --policy-name SecretsManagerAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:{{AWS_REGION}}:{{AWS_ACCOUNT_ID}}:secret:{{PROJECT_SLUG}}/*"
    }]
  }'

# Attach SES send access
aws iam put-role-policy \
  --role-name {{LAMBDA_IAM_ROLE}} \
  --policy-name SESSendAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "*"
    }]
  }'

# Attach DSQL connect access
aws iam put-role-policy \
  --role-name {{LAMBDA_IAM_ROLE}} \
  --policy-name DSQLAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["dsql:DbConnect", "dsql:DbConnectAdmin"],
      "Resource": "*"
    }]
  }'
```

---

## Step 3: Create Aurora DSQL clusters

```bash
# Create staging cluster
aws dsql create-cluster --region {{AWS_REGION}} --tags Key=env,Value=staging

# Create production cluster
aws dsql create-cluster --region {{AWS_REGION}} --tags Key=env,Value=production
```

Note the hostnames. Update `{{STAGING_DSQL_ENDPOINT}}` and `{{PROD_DSQL_ENDPOINT}}` in your config.

---

## Step 4: Run database migrations

```bash
# Staging
node backend/run-dsql-migrations.mjs --cluster {{STAGING_DSQL_ENDPOINT}} --setup

# Production
node backend/run-dsql-migrations.mjs --cluster {{PROD_DSQL_ENDPOINT}} --setup
```

---

## Step 5: Create Secrets Manager entries

```bash
# Staging
aws secretsmanager create-secret \
  --name "{{PROJECT_SLUG}}/staging" \
  --secret-string '{
    "DSQL_ENDPOINT": "{{STAGING_DSQL_ENDPOINT}}:5432",
    "JWT_SECRET": "<generate a strong random string>",
    "EMAIL_FROM": "{{PROJECT_NAME}} <noreply@{{DOMAIN}}>",
    "APP_URL": "https://{{DOMAIN}}",
    "API_URL": "https://{{PROD_API_GATEWAY_ID}}.execute-api.{{AWS_REGION}}.amazonaws.com"
  }'

# Production
aws secretsmanager create-secret \
  --name "{{PROJECT_SLUG}}/production" \
  --secret-string '{
    "DSQL_ENDPOINT": "{{PROD_DSQL_ENDPOINT}}:5432",
    "JWT_SECRET": "<generate a strong random string — different from staging>",
    "EMAIL_FROM": "{{PROJECT_NAME}} <noreply@{{DOMAIN}}>",
    "APP_URL": "https://{{DOMAIN}}",
    "API_URL": "https://{{PROD_API_GATEWAY_ID}}.execute-api.{{AWS_REGION}}.amazonaws.com"
  }'
```

---

## Step 6: Create S3 bucket

```bash
aws s3 mb s3://{{S3_BUCKET}} --region {{AWS_REGION}}

# Enable static website hosting
aws s3 website s3://{{S3_BUCKET}} --index-document index.html --error-document index.html

# Bucket policy for public read (website files only)
aws s3api put-bucket-policy --bucket {{S3_BUCKET}} --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::{{S3_BUCKET}}/website/*"
  }]
}'
```

---

## Step 7: Create Lambda functions

```bash
# Package first
cd backend && npm ci && zip -r ../lambda.zip . && cd ..

# Create staging Lambda
aws lambda create-function \
  --function-name {{STAGING_LAMBDA}} \
  --runtime nodejs24.x \
  --role arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/{{LAMBDA_IAM_ROLE}} \
  --handler lambda.handler \
  --zip-file fileb://lambda.zip \
  --timeout 90 \
  --memory-size 512 \
  --environment Variables="{NODE_ENV=production,SECRETS_NAME={{PROJECT_SLUG}}/staging}"

# Create production Lambda
aws lambda create-function \
  --function-name {{PROD_LAMBDA}} \
  --runtime nodejs24.x \
  --role arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/{{LAMBDA_IAM_ROLE}} \
  --handler lambda.handler \
  --zip-file fileb://lambda.zip \
  --timeout 90 \
  --memory-size 512 \
  --environment Variables="{NODE_ENV=production,SECRETS_NAME={{PROJECT_SLUG}}/production}"
```

---

## Step 8: Create API Gateway HTTP v2

```bash
# Create staging API
aws apigatewayv2 create-api \
  --name "{{PROJECT_NAME}} Staging" \
  --protocol-type HTTP \
  --cors-configuration AllowOrigins=*,AllowMethods=GET,POST,PUT,DELETE,OPTIONS,AllowHeaders=Content-Type,Authorization

# Create production API (same command, different name)
aws apigatewayv2 create-api \
  --name "{{PROJECT_NAME}} API" \
  --protocol-type HTTP \
  --cors-configuration AllowOrigins=https://{{DOMAIN}},AllowMethods=GET,POST,PUT,DELETE,OPTIONS,AllowHeaders=Content-Type,Authorization
```

Configure Lambda integrations and `$default` routes via console or CLI. Update API Gateway IDs in config.

---

## Step 9: Create ACM certificate + CloudFront

```bash
# Request cert (must be in us-east-1 for CloudFront)
aws acm request-certificate \
  --domain-name {{DOMAIN}} \
  --validation-method DNS \
  --region us-east-1

# Wait for ISSUED status (add CNAME validation records to your DNS first)
aws acm describe-certificate \
  --certificate-arn <cert-arn> \
  --query Certificate.Status \
  --region us-east-1
```

After cert is ISSUED, see `create-cloudfront.sh` for CloudFront setup.

---

## Step 10: Set up .env for local development

```bash
cp backend/.env.example backend/.env
# Fill in DSQL_ENDPOINT (staging), JWT_SECRET, etc.
```

---

## Step 11: First deploy

```bash
# Verify tests pass
cd backend && npm test

# Deploy
bash deploy.sh
```

---

## Step 12: Verify SES email

1. Go to AWS SES console → Verified identities
2. Add your domain ({{DOMAIN}})
3. Add DKIM CNAME records to your DNS provider
4. Wait for verification (usually 5–10 min)

If your account is in SES sandbox, request production access before going live.

---

## Checklist

- [ ] IAM role created with Lambda trust policy
- [ ] IAM policies attached (Secrets Manager, SES, DSQL, basic execution)
- [ ] DSQL clusters created (staging + prod)
- [ ] Migrations run on both clusters
- [ ] Secrets Manager entries created (staging + prod)
- [ ] S3 bucket created with public read policy
- [ ] Lambda functions created (staging + prod)
- [ ] API Gateway HTTP v2 created (staging + prod)
- [ ] Lambda integrations configured in API Gateway
- [ ] ACM cert issued
- [ ] CloudFront distribution created
- [ ] DNS records updated
- [ ] SES domain verified
- [ ] `.env` file created for local dev
- [ ] All `{{PLACEHOLDER}}` values replaced
- [ ] First deploy successful + smoke tests passing

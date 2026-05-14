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

> **Copilot agents can run these commands directly** — no manual console work needed.
> Ask Copilot: *"Provision the DSQL staging and prod clusters for this project."*

```bash
# Create staging cluster (tag Name={{PROJECT_SLUG}}-staging for identification)
STAGING_ID=$(aws dsql create-cluster --region {{AWS_REGION}} --query "identifier" --output text)
aws dsql tag-resource \
  --resource-arn "arn:aws:dsql:{{AWS_REGION}}:{{AWS_ACCOUNT_ID}}:cluster/${STAGING_ID}" \
  --tags "Name={{PROJECT_SLUG}}-staging"
echo "Staging: ${STAGING_ID}.dsql.{{AWS_REGION}}.on.aws"

# Create production cluster (tag Name={{PROJECT_SLUG}}-prod)
PROD_ID=$(aws dsql create-cluster --region {{AWS_REGION}} --query "identifier" --output text)
aws dsql tag-resource \
  --resource-arn "arn:aws:dsql:{{AWS_REGION}}:{{AWS_ACCOUNT_ID}}:cluster/${PROD_ID}" \
  --tags "Name={{PROJECT_SLUG}}-prod"
echo "Prod: ${PROD_ID}.dsql.{{AWS_REGION}}.on.aws"
```

Clusters are typically `ACTIVE` within 60 seconds. Poll with:
```bash
aws dsql get-cluster --identifier $STAGING_ID --region {{AWS_REGION}} --query "status" --output text
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

### 9a. Request the cert (AI can do this)

```bash
CERT_ARN=$(aws acm request-certificate \
  --domain-name {{DOMAIN}} \
  --subject-alternative-names "www.{{DOMAIN}}" \
  --validation-method DNS \
  --region us-east-1 \
  --query CertificateArn --output text) && echo "Cert ARN: $CERT_ARN"

# Get the CNAME validation record AWS needs
aws acm describe-certificate \
  --certificate-arn $CERT_ARN \
  --region us-east-1 \
  --query "Certificate.DomainValidationOptions[0].ResourceRecord" \
  --output json
```

This returns something like:
```json
{
  "Name": "_abc123.{{DOMAIN}}.",
  "Type": "CNAME",
  "Value": "_xyz789.acm-validations.aws."
}
```

### 9b. Add the validation CNAME in Squarespace ⚠️ Manual step

> **Portal**: [domains.squarespace.com](https://domains.squarespace.com) → your domain → DNS  
> **Not** squarespace.com/config (that's the website builder, not DNS) — pitfall #112

1. Click **DNS** for `{{DOMAIN}}`
2. Click **Add record** → type **CNAME**
3. **Host**: paste the `Name` value from above, **strip the trailing dot and the domain suffix**
   - e.g. if `Name` is `_abc123.www.{{DOMAIN}}.` → enter just `_abc123.www`
   - Squarespace appends the domain automatically
4. **Points to**: paste the `Value` from above, strip the trailing dot
5. Save

### 9c. Wait for cert to be ISSUED (AI can poll this)

```bash
# Poll until status = ISSUED (usually 2-5 min after DNS propagates)
aws acm describe-certificate \
  --certificate-arn $CERT_ARN \
  --region us-east-1 \
  --query Certificate.Status \
  --output text
```

⚠️ Do NOT create CloudFront until this returns `ISSUED` — pitfall #113.

### 9d. Create CloudFront distribution (AI can do this)

After cert is ISSUED, run `create-cloudfront.sh` (updates to the script are in the repo).

### 9e. Point www subdomain to CloudFront in Squarespace ⚠️ Manual step

After CloudFront is created (you'll get a domain like `d1234abcd.cloudfront.net`):

1. Go to [domains.squarespace.com](https://domains.squarespace.com) → **DNS**
2. **Add record** → type **CNAME**
3. **Host**: `www`
4. **Points to**: `d1234abcd.cloudfront.net` (your CloudFront domain, no trailing dot)
5. Save

For the apex domain (`{{DOMAIN}}` without www): Squarespace does not support ALIAS records, so add an **URL redirect** record:
- **Host**: `@` (or blank)
- **Redirects to**: `https://www.{{DOMAIN}}`
- Type: **Permanent (301)**

> DNS changes propagate in 1–30 min. Test with `curl -I https://www.{{DOMAIN}}`.

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

## Step 12: Verify SES email domain

### 12a. Add the domain in SES (AI can do this)

```bash
aws sesv2 create-email-identity \
  --email-identity {{DOMAIN}} \
  --dkim-signing-attributes NextSigningKeyLength=RSA_2048_BIT \
  --region us-east-1 \
  --query "DkimAttributes.Tokens" \
  --output json
```

This returns 3 DKIM tokens like `["abc123token", "def456token", "ghi789token"]`.

The CNAME records to add are:
- `abc123token._domainkey.{{DOMAIN}}` → `abc123token.dkim.amazonses.com`
- (same pattern for all 3 tokens)

### 12b. Add DKIM CNAMEs in Squarespace ⚠️ Manual step

> **Portal**: [domains.squarespace.com](https://domains.squarespace.com) → **DNS** (not the website builder)

For each of the 3 tokens:
1. **Add record** → type **CNAME**
2. **Host**: `<token>._domainkey`  (Squarespace appends `.{{DOMAIN}}` automatically — don't include it)
3. **Points to**: `<token>.dkim.amazonses.com`
4. Save

### 12c. Verify DKIM status (AI can poll this)

```bash
aws sesv2 get-email-identity \
  --email-identity {{DOMAIN}} \
  --region us-east-1 \
  --query "DkimAttributes.Status" \
  --output text
```

Wait for `SUCCESS` (usually 5–10 min after DNS propagates).

### 12d. Request SES production access (if in sandbox)

New AWS accounts start in sandbox mode (can only send to verified addresses). Request production access:

1. Go to **AWS SES Console** → **Account dashboard**
2. Click **Request production access**
3. Fill in use case, estimated volume, and bounce handling details
4. Approval typically takes 24 hours

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

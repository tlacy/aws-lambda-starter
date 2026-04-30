#!/bin/bash
# {{PROJECT_NAME}} Backend Deployment Script
# Validates → packages Lambda → deploys staging → smoke tests → deploys production

set -e

echo "🚀 Starting deployment..."
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

cd "$(dirname "$0")"

# ─── Pre-flight: Require clean git state (pitfall #106) ───────────────────────
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo -e "${RED}❌ Uncommitted changes detected. Commit before deploying.${NC}"
    echo ""
    git status --short
    echo ""
    echo -e "${YELLOW}Run: git add . && git commit -m 'your message' then re-run deploy.sh${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Git working tree is clean${NC}"
echo ""

STAGING_LAMBDA="{{STAGING_LAMBDA}}"
PROD_LAMBDA="{{PROD_LAMBDA}}"
S3_BUCKET="{{S3_BUCKET}}"
AWS_ACCOUNT_ID="{{AWS_ACCOUNT_ID}}"
AWS_REGION="{{AWS_REGION}}"
STAGING_API_GATEWAY_ID="{{STAGING_API_GATEWAY_ID}}"
PROD_API_GATEWAY_ID="{{PROD_API_GATEWAY_ID}}"
PROJECT_SLUG="{{PROJECT_SLUG}}"

STAGING_API_URL="${STAGING_API_URL:-https://${STAGING_API_GATEWAY_ID}.execute-api.${AWS_REGION}.amazonaws.com}"
PROD_API_URL="${PROD_API_URL:-https://${PROD_API_GATEWAY_ID}.execute-api.${AWS_REGION}.amazonaws.com}"

# ─── Step 1: Schema contract test ────────────────────────────────────────────
echo -e "${CYAN}Step 1/7: Validating schema contract...${NC}"
if npm test -- tests/production-schema-contract.test.js --silent > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Schema contract passed${NC}"
else
    echo -e "${RED}❌ Schema contract validation failed${NC}"
    echo -e "${YELLOW}Run: npm test -- tests/production-schema-contract.test.js${NC}"
    exit 1
fi
echo ""

# ─── Step 2: Full test suite ─────────────────────────────────────────────────
echo -e "${CYAN}Step 2/7: Running tests...${NC}"
npm test -- --passWithNoTests 2>&1 | tail -5
TEST_EXIT=$?
if [ $TEST_EXIT -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed${NC}"
else
    echo -e "${RED}❌ Tests failed — aborting deploy${NC}"
    exit 1
fi
echo ""

# ─── Step 3: Package Lambda (production deps only, pitfall #56) ──────────────
echo -e "${CYAN}Step 3/7: Packaging Lambda...${NC}"
rm -rf lambda-temp lambda-deployment.zip

mkdir lambda-temp
rsync -a src/ lambda-temp/src/
cp lambda.js package.json package-lock.json lambda-temp/

cd lambda-temp
npm ci --omit=dev --omit=optional --production --quiet > /dev/null 2>&1
cd ..

cd lambda-temp && zip -q -r ../lambda-deployment.zip . && cd ..
rm -rf lambda-temp

PACKAGE_SIZE=$(du -h lambda-deployment.zip | cut -f1)
echo -e "${GREEN}✅ Package: ${PACKAGE_SIZE}${NC}"
echo ""

# ─── Step 4: Upload to S3 ────────────────────────────────────────────────────
echo -e "${CYAN}Step 4/7: Uploading to S3...${NC}"
aws s3 cp lambda-deployment.zip "s3://${S3_BUCKET}/" || {
    echo -e "${RED}❌ S3 upload failed${NC}"
    exit 1
}
echo -e "${GREEN}✅ Uploaded${NC}"
echo ""

# ─── Step 5: Deploy to staging + smoke tests ─────────────────────────────────
echo -e "${CYAN}Step 5/7: Deploying to STAGING...${NC}"
aws lambda update-function-code \
    --function-name "$STAGING_LAMBDA" \
    --s3-bucket "$S3_BUCKET" \
    --s3-key lambda-deployment.zip \
    --no-cli-pager > /dev/null 2>&1

echo -e "${YELLOW}⏳ Waiting for staging deployment...${NC}"
aws lambda wait function-updated --function-name "$STAGING_LAMBDA"

# pitfall #83: wait before update-function-configuration
aws lambda update-function-configuration \
    --function-name "$STAGING_LAMBDA" \
    --timeout 90 \
    --environment "Variables={NODE_ENV=production,SECRETS_NAME=${PROJECT_SLUG}/staging}" \
    --no-cli-pager > /dev/null 2>&1 || {
    echo -e "${RED}❌ Failed to set staging env vars${NC}"
    exit 1
}

# Ensure API Gateway has permission to invoke (idempotent)
aws lambda remove-permission --function-name "$STAGING_LAMBDA" --statement-id AllowAPIGWInvoke --region "${AWS_REGION}" > /dev/null 2>&1 || true
aws lambda add-permission \
    --function-name "$STAGING_LAMBDA" \
    --statement-id AllowAPIGWInvoke \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${AWS_REGION}:${AWS_ACCOUNT_ID}:${STAGING_API_GATEWAY_ID}/*/*" \
    --no-cli-pager > /dev/null 2>&1

echo -e "${YELLOW}⏳ Warming up staging...${NC}"
sleep 10

echo -e "${CYAN}Running smoke tests against staging (${STAGING_API_URL})...${NC}"
if node smoke-test.mjs "$STAGING_API_URL"; then
    echo -e "${GREEN}✅ Staging smoke tests passed${NC}"
else
    echo -e "${RED}❌ STAGING SMOKE TESTS FAILED — aborting production deploy${NC}"
    echo -e "${YELLOW}Logs: aws logs tail /aws/lambda/${STAGING_LAMBDA} --follow${NC}"
    exit 1
fi
echo ""

# ─── Step 6: Deploy to production ────────────────────────────────────────────
echo -e "${CYAN}Step 6/7: Deploying to PRODUCTION...${NC}"
aws lambda update-function-code \
    --function-name "$PROD_LAMBDA" \
    --s3-bucket "$S3_BUCKET" \
    --s3-key lambda-deployment.zip \
    --no-cli-pager > /dev/null 2>&1

echo -e "${YELLOW}⏳ Waiting for production deployment...${NC}"
aws lambda wait function-updated --function-name "$PROD_LAMBDA"
sleep 3  # let Lambda fully settle before config update (race condition fix — pitfall #83)

# pitfall #81: include ALL required vars to avoid wiping existing env
aws lambda update-function-configuration \
    --function-name "$PROD_LAMBDA" \
    --timeout 90 \
    --environment "Variables={NODE_ENV=production,SECRETS_NAME=${PROJECT_SLUG}/production}" \
    --no-cli-pager > /dev/null 2>&1 || {
    echo -e "${RED}❌ Failed to set production env vars${NC}"
    exit 1
}

# Ensure API Gateway has permission to invoke (idempotent)
aws lambda remove-permission --function-name "$PROD_LAMBDA" --statement-id AllowAPIGWInvoke --region "${AWS_REGION}" > /dev/null 2>&1 || true
aws lambda add-permission \
    --function-name "$PROD_LAMBDA" \
    --statement-id AllowAPIGWInvoke \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${AWS_REGION}:${AWS_ACCOUNT_ID}:${PROD_API_GATEWAY_ID}/*/*" \
    --no-cli-pager > /dev/null 2>&1

echo -e "${YELLOW}⏳ Warming up production...${NC}"
sleep 10
echo ""

# ─── Step 7: Production smoke tests ──────────────────────────────────────────
echo -e "${CYAN}Step 7/7: Running production smoke tests...${NC}"
if node smoke-test.mjs "$PROD_API_URL"; then
    echo -e "${GREEN}✅ Production smoke tests passed${NC}"
else
    echo -e "${YELLOW}⚠️  Production smoke tests failed — check CloudWatch logs${NC}"
    echo -e "${YELLOW}Logs: aws logs tail /aws/lambda/${PROD_LAMBDA} --follow${NC}"
    exit 1
fi
echo ""

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo -e "API: ${PROD_API_URL}"
echo -e "Site: https://www.{{DOMAIN}}"

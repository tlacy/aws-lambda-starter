#!/usr/bin/env bash
set -euo pipefail

# deploy-frontend.sh — Deploys website/ to S3 and invalidates CloudFront.
# IMPORTANT: Commit any frontend changes BEFORE running this script (pitfall #91).

S3_BUCKET="{{S3_BUCKET}}"
S3_PREFIX="website"
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-{{CLOUDFRONT_DIST_ID}}}"

echo "☁️  Syncing to S3..."
aws s3 sync website/ "s3://${S3_BUCKET}/${S3_PREFIX}/" \
  --delete \
  --cache-control "no-cache, no-store, must-revalidate"
echo "✅ S3 sync complete"

echo "🔄 CloudFront invalidation..."
if [ "$CLOUDFRONT_DISTRIBUTION_ID" = "{{CLOUDFRONT_DIST_ID}}" ]; then
  echo "⚠️  CLOUDFRONT_DISTRIBUTION_ID not configured — skipping"
  echo "   Update {{CLOUDFRONT_DIST_ID}} in this script, or set env var:"
  echo "   CLOUDFRONT_DISTRIBUTION_ID=<your-id> bash deploy-frontend.sh"
else
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
    --paths "/*"
  echo "✅ Invalidation queued (~60s to propagate)"
fi

echo ""
echo "✅ Frontend deployed!"
echo "   Site: https://www.{{DOMAIN}}"

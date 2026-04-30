# {{PROJECT_NAME}} — Agent State

> **For new agents**: Read this file FIRST. It contains the live state of the project.
> Do NOT use the VS Code memory tool (`/memories/repo/`) for project state — this file is the source of truth.

---

## Quick Reference

| | |
|---|---|
| **Deploy backend** | `cd backend && bash deploy.sh` |
| **Deploy frontend** | `bash deploy-frontend.sh` (commit first) |
| **Run tests** | `cd backend && npm test` |
| **Run smoke tests** | `node backend/smoke-test.mjs <api-url>` |
| **Run migrations** | `node backend/run-dsql-migrations.mjs --cluster <hostname>` |
| **Schema contract** | `backend/production-schema-contract.json` |

---

## Infrastructure Status

| Resource | Value | Status |
|---|---|---|
| Lambda (prod) | `{{PROD_LAMBDA}}` | ⏳ |
| Lambda (staging) | `{{STAGING_LAMBDA}}` | ⏳ |
| API Gateway (prod) | `{{PROD_API_GATEWAY_ID}}.execute-api.{{AWS_REGION}}.amazonaws.com` | ⏳ |
| API Gateway (staging) | `{{STAGING_API_GATEWAY_ID}}.execute-api.{{AWS_REGION}}.amazonaws.com` | ⏳ |
| DSQL (prod) | `{{PROD_DSQL_ENDPOINT}}` | ⏳ |
| DSQL (staging) | `{{STAGING_DSQL_ENDPOINT}}` | ⏳ |
| IAM Role | `{{LAMBDA_IAM_ROLE}}` | ⏳ |
| S3 Bucket | `{{S3_BUCKET}}` | ⏳ |
| CloudFront | `{{CLOUDFRONT_DIST_ID}}` — `{{DOMAIN}}` | ⏳ |

---

## Test Count

**Current: 0/0** (no tests yet — update as you write them)

Test files:
- `backend/tests/auth.test.js` — auth flows
- `backend/tests/security.test.js` — OWASP security checks
- `backend/tests/production-schema-contract.test.js` — schema validation

---

## Schema

See `backend/production-schema-contract.json` for the authoritative schema.

Tables (update as you add migrations):
- `users`
- `password_reset_tokens`
- `failed_login_attempts`
- `migrations`

---

## Recent Sessions

### YYYY-MM-DD (session 1) — Initial setup
- Scaffolded from `aws-lambda-starter` template
- TODO: fill in infrastructure values
- TODO: run initial migrations on both DSQL clusters
- TODO: deploy to staging + production

---

## Known Issues / Pending

- [ ] Fill in all `{{PLACEHOLDER}}` values in `.github/copilot-instructions.md`
- [ ] Fill in all `{{PLACEHOLDER}}` values in `docs/AGENT_STATE.md`
- [ ] Fill in all `{{PLACEHOLDER}}` values in `backend/deploy.sh`
- [ ] Fill in all `{{PLACEHOLDER}}` values in `deploy-frontend.sh`
- [ ] Update `backend/src/services/email.js` with project-specific email templates
- [ ] Update `backend/src/app.js` CORS origins for your domain
- [ ] Run `node backend/run-dsql-migrations.mjs --cluster <staging-hostname> --setup`
- [ ] Run `node backend/run-dsql-migrations.mjs --cluster <prod-hostname> --setup`
- [ ] Deploy to staging and verify smoke tests pass
- [ ] Deploy to production

---

## Setup Checklist (new project)

See `SETUP.md` for the full step-by-step infrastructure setup.

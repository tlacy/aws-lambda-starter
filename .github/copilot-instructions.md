# GitHub Copilot Instructions for {{PROJECT_NAME}}

## NEW AGENT: READ THIS FIRST

**What this is**: {{PROJECT_DESCRIPTION}}

**Read `docs/AGENT_STATE.md` immediately** — it has the live-state snapshot (test counts, deployed features, deploy commands, schema, recent sessions). It lives in the git repo (visible, versioned). Do NOT use the hidden VS Code memory tool (`/memories/repo/`) for project state.

**Key files at a glance:**
| Area | File(s) |
|---|---|
| **Agent state (READ FIRST)** | `docs/AGENT_STATE.md` — test counts, schema, deploy commands, recent sessions |
| Frontend (SPA) | `website/` — vanilla JS HTML pages |
| Backend entry | `backend/src/app.js` (Express), `backend/lambda.js` (Lambda wrapper) |
| Routes | `backend/src/routes/` |
| Tests | `backend/tests/` |
| Smoke tests | `backend/smoke-test.mjs` |
| Schema contract | `backend/production-schema-contract.json` |
| Migrations | `backend/run-dsql-migrations.mjs` |
| Deploy backend | `cd backend && bash deploy.sh` |
| Deploy frontend | `bash deploy-frontend.sh` (commit first) |

**Stack**: Vanilla JS SPA → API Gateway HTTP v2 → Lambda (Node 24.x, Express) → Aurora DSQL (PostgreSQL-compatible, IAM auth). DSQL-only — no local PostgreSQL anywhere.

**Three rules you cannot skip without ending the session:**
1. `node --check website/app.js` before any frontend deploy
2. `npm test` all passing before any backend deploy
3. Never bypass the staging gate in `deploy.sh`

**One rule you cannot skip for UI work:**
4. If the task references a URL as the design/inspiration source — fetch it FIRST, before reading any current code. If the fetch fails, try `http://`, raw GitHub, and GitHub API variants before giving up (pitfall #121). Anchoring on current implementation instead of the reference is the most expensive UI mistake pattern (#120).

⚠️ **DSQL is NOT standard PostgreSQL** — IAM auth with `presign()` required, no SERIAL/SEQUENCES/FOREIGN KEYs, no CASE WHEN in parameterized VALUES, ALTER TABLE ADD COLUMN accepts no constraints. See pitfalls #23–32 for the full list.

---

## LIVE INFRASTRUCTURE

| Resource | Value | Status |
|---|---|---|
| Lambda (prod) | `{{PROD_LAMBDA}}` (Node 24.x, 512MB, 60s) | ⏳ Setup required |
| Lambda (staging) | `{{STAGING_LAMBDA}}` | ⏳ Setup required |
| API Gateway (prod) | `{{PROD_API_GATEWAY_ID}}.execute-api.{{AWS_REGION}}.amazonaws.com` | ⏳ Setup required |
| API Gateway (staging) | `{{STAGING_API_GATEWAY_ID}}.execute-api.{{AWS_REGION}}.amazonaws.com` | ⏳ Setup required |
| DSQL (prod) | `{{PROD_DSQL_ENDPOINT}}` | ⏳ Setup required |
| DSQL (staging) | `{{STAGING_DSQL_ENDPOINT}}` | ⏳ Setup required |
| IAM Role | `{{LAMBDA_IAM_ROLE}}` | ⏳ Setup required |
| S3 Bucket | `{{S3_BUCKET}}` (website/ prefix) | ⏳ Setup required |
| ACM Cert | `{{ACM_CERT_ARN}}` | ⏳ Setup required |
| CloudFront | `{{CLOUDFRONT_DIST_ID}}` — `{{DOMAIN}}` | ⏳ Setup required |
| Account | `{{AWS_ACCOUNT_ID}}` / `{{AWS_REGION}}` | — |

**Secrets Manager keys** (both envs — NO Mailgun): `DSQL_ENDPOINT`, `JWT_SECRET`, `EMAIL_FROM`, `APP_URL`, `API_URL`

## EMAIL: AWS SES (NOT MAILGUN)

Email uses **AWS SES with IAM role auth** — no API key, no SMTP credentials needed.
- Service: `backend/src/services/email.js` — lazy `getSESClient()` singleton
- Auth: `@aws-sdk/client-ses` uses Lambda execution role automatically in production
- Config: only `EMAIL_FROM` in Secrets Manager (no MAILGUN_* keys exist)
- Test mode: `NODE_ENV=test` → logs to console only, returns `{ MessageId: 'test-mode' }`
- Verify your domain in AWS SES console, add DKIM CNAMEs to your DNS provider

**Never add Mailgun keys** — all email is SES.

---

## WORKING RELATIONSHIP

**We work as partners, not as agent/user:**
- **Ask, don't improvise** - If you think a step should be skipped, ASK first
- **Follow the documented process** - Don't go off the rails to get things done quickly
- **Communicate clearly** - Explain what you're doing and why
- **Respect time and money** - Wasted iterations cost real money

⚠️ **If you violate these principles, the user should immediately stop the session.** The pattern of "move fast and fix later" has a documented cost: $30–50 per debugging session, 30+ minutes of production downtime per violation. These principles exist because they have been violated before.

---

## ENVIRONMENT PARITY

**DSQL-only policy**: All environments (dev, test, staging, prod) connect to DSQL. Dev/test use `aws dsql generate-db-connect-admin-auth-token` for admin access. Production uses Lambda IAM role token. There is NO local PostgreSQL fallback.

**Infrastructure blind spots**:
- API Gateway base64 encoding of binary bodies (+33% size) — invisible to unit tests
- Lambda 6MB synchronous invocation limit
- CORS headers returned by Lambda middleware
- Cold start timeouts

Staging gate is mandatory. `deploy.sh` runs smoke tests against staging before promoting to production.

---

## AUTOMATIC ROLE-SWITCHING

| When the user... | Switch to... | Do this first |
|---|---|---|
| Proposes new feature | **Product Owner** | Assess value, challenge assumptions |
| Reports a bug | **QA + Security** | Root cause, write reproducing test |
| About to deploy | **DevOps + QA** | Run mandatory checklist |
| Architecture question | **Lead Developer** | Present tradeoffs |

**Pattern to break**:
❌ User proposes feature → Agent immediately starts coding
✅ User proposes feature → Agent asks: (1) What problem does this solve? (2) Is there a simpler path? (3) Does a version already exist? (4) What's the test strategy? → THEN starts coding

---

## CRITICAL: Verify Before Starting

Before diagnosing issues:
1. Check DSQL connection: `aws dsql generate-db-connect-admin-auth-token --hostname <cluster> --region {{AWS_REGION}} --output text`
2. Check `docs/AGENT_STATE.md` for current state
3. Check `backend/production-schema-contract.json` for schema
4. Read route files before querying databases

---

## PROACTIVE PITFALL SCAN — MANDATORY BEFORE ACTING

**The most expensive mistakes happen when the agent is confident, not when it's uncertain.**
Overconfidence bypasses the check. Treat high confidence as a trigger to verify, not a reason to skip.

Before taking any action in these areas, **stop and scan the relevant pitfalls**:

| Area | Scan these pitfalls before acting |
|---|---|
| DNS / domain records | #112 (Squarespace ≠ Google despite googledomains.com nameservers) |
| AWS deployments | #56, #74, #75, #81, #83, #84, #91, #92, #106 |
| DSQL schema / DDL | #1, #2, #13, #14, #23–32, #89, #97, #100, #102 |
| Auth / email flows | #62, #71, #73, #80, #82, #95, #108 |
| Frontend changes | #7, #36, #42, #64, #74 |
| New API routes | #4, #39, #40, #79, #86, #87, #88, #98, #103 |
| Tests | #5, #12, #44, #55, #68, #78, #93, #94, #104 |
| Features (new build) | #3, #15, #18, #19, #20, #53, #65 |
| UI improvements | **#120, #121** — fetch reference URL FIRST, try all URL variants if fetch fails |

**Rule**: If you're about to touch any of these areas and you haven't explicitly scanned the listed pitfalls, stop and read them first.

---

## Core Development Standards

### CRITICAL Workflow

1. **Tests First** — Write tests BEFORE asking user to test in browser
2. **Run Tests Before Completion** — Show `X/X passing` before declaring done
3. **Never say "ready for browser testing"** without passing tests
4. **node --check website/app.js** before any frontend change

### Backend
- **Framework**: Express.js with ES6 modules (`"type": "module"`)
- **Database**: Aurora DSQL only — `backend/src/database/db.js`
- **Primary Keys**: UUIDs with `gen_random_uuid()`
- **Auth**: JWT via middleware in `backend/src/middleware/auth.js`
- **Testing**: Jest with supertest (ESM mode, `transform: {}`)

### Frontend
- **Stack**: Vanilla JavaScript (no frameworks)
- **Architecture**: Modal-based SPA or multi-page
- **API**: Fetch with Bearer token
- **Environment detection** (pitfall #36): every HTML page must detect localhost vs prod

### Testing Standards
- Import: `import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals'` (pitfall #93)
- Clean test data in `beforeAll` BEFORE creating (pitfall #12)
- `email_verified` is SMALLINT — use `= 1` not `= true` (pitfall #104)
- COUNT results: cast with `parseInt(..., 10)` (pitfall #78)
- Time-based features: use time-travel SQL instead of sleep (pitfall #68)
- Test passwords must meet strength requirements: `TestUser@123!` style

### Complete Flow Testing (MANDATORY for email + access features)
Unit tests on individual routes are not sufficient. Every user-facing flow that spans multiple steps must have an end-to-end test covering the full path. For any feature that sends an email with an action link:

1. **Map the full flow before writing any code**: request → email built → link URL → route handler → DB state → response
2. **Test each link in the email**: extract the URL from the email service, hit it as a real HTTP request via supertest, verify the expected DB state change and HTTP response
3. **The route must exist before the email sends it** — write the route and its test together, never independently

---

## Common Pitfalls to Avoid

**General (1–21):**
1. **Don't assume database schema** — Always check actual column names in `production-schema-contract.json` before writing queries.
2. **Don't use non-PostgreSQL SQL syntax** — DSQL uses PostgreSQL-compatible syntax: `$1, $2` placeholders (not `?`), `NOW()`, `CURRENT_TIMESTAMP - INTERVAL '20 minutes'`.
3. **Don't test in browser first** — Write code → write tests → tests pass → THEN verify in browser.
4. **Don't skip authentication tests** — Every protected route must have a test that verifies 401 without a token.
5. **Don't forget test data cleanup** — Clean in `beforeAll` BEFORE creating fresh data, and again in `afterAll`.
6. **Don't batch completions** — Mark todos completed immediately after finishing each one.
7. **Don't skip syntax validation** — Always run `node --check website/app.js` after frontend edits.
8. **Don't leave orphaned code** — Review full context of edits to catch duplicate or incomplete blocks.
9. **Don't hard-code entity types** — Use flexible patterns when the data model could evolve.
10. **Don't forget test timeouts** — Long-running tests (AI calls, etc.) need `testTimeout: 60000` in jest config.
11. **Don't assume DOM sibling relationships** — Always verify actual HTML structure before using `previousElementSibling`. Use `parentElement.querySelector()`.
12. **Don't skip test data cleanup in beforeAll** — Clean existing test users/data BEFORE creating fresh test data:
    ```javascript
    beforeAll(async () => {
      const existing = await db.queryOne('SELECT id FROM users WHERE email = $1', ['test@test.com']);
      if (existing) {
        await db.query('DELETE FROM <child_table> WHERE user_id = $1', [existing.id]);
        await db.query('DELETE FROM users WHERE id = $1', [existing.id]);
      }
    });
    ```
13. **Don't assume table names match migration files** — Verify actual table names with `production-schema-contract.json`.
14. **Don't ignore schema errors** — Check `production-schema-contract.json` before every new query.
15. **Don't ask user to test before writing tests** — Write tests FIRST.
16. **Don't default form fields to empty strings** — Backend must sanitize: `value === '' ? null : value`.
17. **Don't assume HEIC support in Claude Vision** — Claude Vision only supports JPEG, PNG, GIF, WebP.
18. **Don't implement features without tests when user already called out the violation.**
19. **Don't debug backend 500s iteratively in browser** — Use CloudWatch/Lambda logs + failing test.
20. **Don't assume field names match across frontend/backend** — Always check backend route's response shape.
21. **Don't forget UUID validation** — Validate UUID format BEFORE querying:
    ```javascript
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(id)) return res.status(404).json({ error: 'Resource not found' });
    ```

**DSQL-specific (23–32):**
23. **Don't assume Aurora DSQL is standard PostgreSQL** — requires IAM auth with temporary tokens
24. **Don't use standard PostgreSQL GRANT for DSQL** — requires proprietary `AWS IAM GRANT` syntax
25. **Don't use full IAM ARN as DSQL username** — use role name only (e.g. `{{LAMBDA_IAM_ROLE}}`)
26. **Don't use sign() for DSQL** — use `signer.presign()` (NOT `signer.sign()`)
27. **Don't use SET ROLE in DSQL** — not supported
28. **Don't run multiple DDL statements in one DSQL connection** — use psql -f for multi-statement files
29. **Don't try to change DSQL table ownership** — must drop + recreate
30. **Don't use inline node scripts for DSQL DDL** — use psql -f with temp files
31. **Don't add constraints in DSQL ALTER TABLE ADD COLUMN** — add column bare, then UPDATE existing rows
32. **Don't use S3 ACLs** — use bucket policies

**AWS / Deploy (33–92):**
33. **Don't add trailing dots to DNS records in consumer DNS providers**
34. **Don't use S3 REST endpoint for CloudFront** — use S3 website endpoint
36. **Don't hardcode API URLs in standalone HTML pages** — use environment detection:
    ```javascript
    const API_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ? 'http://localhost:3000' : 'https://{{PROD_API_GATEWAY_ID}}.execute-api.{{AWS_REGION}}.amazonaws.com';
    ```
38. **Don't assume Lambda execution role trust policy is correct** — must trust `lambda.amazonaws.com`
39. **Don't handle CORS at API Gateway level for /{proxy+}** — Lambda must return CORS headers
40. **Don't deploy without schema contract validation** — `production-schema-contract.json` + test in every `npm test`
42. **Don't call tests "comprehensive" without syntax validation** — `node --check website/app.js` first
44. **Don't forget test cleanup queries need schema validation** — cleanup joins must match actual schema
45. **Don't mix PUT/POST content types without backend coordination** — POST with file = FormData, PUT without file = JSON
46. **Don't send empty strings for INTEGER/DATE columns** — sanitize: `value === '' ? null : value`
56. **Don't deploy with dev/optional dependencies** — `npm ci --omit=dev --omit=optional`
57. **Don't implement UI without mobile-first approach** — 44px touch targets, auto-fit grid
62. **Don't initialize services at module level in Lambda** — lazy-load: read env vars at call time
64. **Don't reference non-existent CSS files in production** — all styles inline or verify before referencing
65. **Don't implement security features without checking if they exist** — search first
66. **Don't expose error.message in API responses** — OWASP A05: generic client messages, detailed server logs
68. **Don't test time-based features with sleep()** — time-travel: `UPDATE ... SET timestamp = CURRENT_TIMESTAMP - INTERVAL '20 minutes'`
71. **Don't assume Lambda instantly uses updated Secrets Manager values** — force cold start after secret updates
73. **Don't let error handlers fall through to success paths** — rethrow or return early after catch
74. **Don't forget CloudFront cache invalidation after S3 deployments**
75. **Don't skip validation before deployment (MANDATORY WORKFLOW)**
77. **Don't validate inputs after trimming** — trim FIRST, then validate
78. **Don't expect PostgreSQL COUNT to return numbers** — `parseInt(count, 10)`
79. **Don't assume authorization middleware applies to all routes** — audit ALL routes when adding auth requirements
80. **Don't assume email verification works without testing the complete flow**
81. **Don't use `update-function-configuration` with partial Variables** — replaces ALL env vars; always include ALL required vars: `NODE_ENV=production,SECRETS_NAME={{PROJECT_SLUG}}/production`
82. **Don't set APP_URL without www prefix** — DNS redirects strip path + query string from non-www
83. **Don't call `update-function-configuration` immediately after `update-function-code`** — use `aws lambda wait function-updated` + `sleep 3`
84. **Don't let frontend deploy script try to create existing CloudFront distribution** — separate one-time setup from recurring deploy
89. **Don't assume DSQL ALTER TABLE ADD COLUMN applies a DEFAULT** — use `COALESCE(column, default)` in all queries; `NULL + 1 = NULL`
91. **Don't deploy without committing first when deploy script runs `git checkout -- file`** — commit → push → deploy
93. **Don't use `jest` as a global in ESM test files** — `import { jest } from '@jest/globals'`
94. **Don't use `jest.mock()` to spy on ES module email functions** — use console log assertions instead
95. **Don't send admin new-user notifications at registration** — send at email verification
96. **Don't use CASE WHEN in PostgreSQL INSERT VALUES with parameterized queries** — compute in JS first
97. **DDL IS automatable via admin token** — `aws dsql generate-db-connect-admin-auth-token` + `psql` as `admin` user gives full DDL access
98. **Don't treat smoke-test.mjs as a one-time file** — add smoke test for every new API endpoint
99. **Don't `npm install` platform-specific packages inside lambda-temp** — use isolated temp dir pattern
100. **Don't assume new DSQL tables have Lambda role permissions** — GRANT after every CREATE TABLE
102. **Don't run DSQL DDL statements in separate per-connection calls when statements have dependencies** — use `psql -f` for multi-statement files
103. **Don't edit route files without verifying which file is actually imported** — `grep "import.*routes" backend/src/app.js`
104. **Don't ask user to run live-AI tests manually** — read `backend/.env` for API keys
105. **Routes must be in `backend/src/app.js`** (shared entry point used by both server.js and lambda.js)
106. **Don't deploy backend without committing first** — `deploy.sh` checks git clean state
107. **Don't hardcode operational tuning knobs** — use env vars: `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `BODY_SIZE_LIMIT`
108. **Don't build confirm/attribution links using APP_URL** — use `API_URL` for `/api/*` action links in emails
109. **Don't add migration files to wrong directory** — `database/migrations/NNN_description.sql` only
110. **Don't defer roadmap/instruction updates when user explicitly asks** — do it immediately
111. **Never document actual credentials** — use `<redacted>` in all docs; credentials only in Secrets Manager or `.env`
112. **`ns-cloud-a*.googledomains.com` nameservers = Squarespace Domains, NOT Google** — Google sold Google Domains to Squarespace in 2023. Management portal is [domains.squarespace.com](https://domains.squarespace.com) → DNS.
113. **Don't create CloudFront before ACM cert is ISSUED** — poll with `aws acm describe-certificate ... --query Certificate.Status` until `ISSUED`.
114. **Don't set CloudFront `DefaultRootObject` and forget `index.html` in S3** — if root page is `landing.html`, create a thin `index.html` redirect.
115. **Don't try to increase the API Gateway HTTP v2 timeout past 29s** — hard limit; use async Lambda self-invoke pattern for long operations.
116. **Don't self-invoke Lambda without the IAM permission** — add `lambda:InvokeFunction` to execution role.
117. **Don't forget local/test fallback when `AWS_LAMBDA_FUNCTION_NAME` is absent** — guard with `if (process.env.AWS_LAMBDA_FUNCTION_NAME)`.
118. **Don't use `event.type` as async job discriminator without checking in `lambda.js`** — handler must check `if (event.type === 'some_job')` before passing to serverless-express.
120. **A URL in a test/data file is the spec — fetch it first, before reading current code**
121. **Don't give up on `fetch_webpage` after one failure — try http://, raw GitHub, GitHub API variants**
122. **"You're right" ≠ behavior change — write the pitfall immediately when the pattern is identified**
124. **Never ship an email with an action link without a test that clicks the link** — every `send*Email()` call that includes an action URL must have a corresponding test that hits that URL via supertest.

---

## Security-First Mindset

**Authentication & Authorization**:
- JWT 7-day tokens, bcryptjs 10 rounds
- Account lockout: 5 failed attempts per email per 15 minutes → 429
- Token expiration: Password reset (1hr), Email verification (24hr)
- Prevent email enumeration (same response for unknown email)
- Password strength: 8+ chars, uppercase, lowercase, number, special character

**Error Handling (OWASP A05)**:
```javascript
try {
  // logic
} catch (error) {
  console.error('Context:', error); // detailed server log
  return res.status(500).json({ error: 'Failed to process request' }); // generic client
}
```

**Rate Limiting**:
- IP-based: `RATE_LIMIT_MAX` (300) per `RATE_LIMIT_WINDOW_MS` (900000ms = 15min)
- Email-based: 5 failed logins per email per 15min (DB-backed)

---

## Before Marking Work Complete

- [ ] Tests written and passing (show count: X/X)
- [ ] Error handling implemented
- [ ] Database queries use correct column names (check schema-contract.json)
- [ ] **JavaScript syntax checked with `node --check` for frontend changes (MANDATORY)**
- [ ] **Backend tests run after API changes (MANDATORY)**
- [ ] **New API routes have a smoke test added (MANDATORY)**
- [ ] **Every email action link has an end-to-end test that hits the linked route (MANDATORY — pitfall #124)**

---

## When User Says "Gotta Go" / End of Session

1. **`docs/AGENT_STATE.md`** — Update test count, recent sessions, known issues
2. **`.github/copilot-instructions.md`** — Add new pitfalls discovered this session (numbered, with cost/example/date)
3. **`chat-history/session-YYYY-MM-DD-topic.md`** — Create session log
4. **`docs/PRODUCT_ROADMAP.md`** — Move shipped items to ✅ Shipped
5. **`QUICK_START.md`** — Update counts if changed

**Prune, don't just append:**
- Remove pitfalls that no longer apply
- Trim session summaries in `docs/AGENT_STATE.md` older than ~3 sessions
- `copilot-instructions.md` should get tighter over time, not just longer

Then: `git add . && git commit -m "End-of-session doc updates"`

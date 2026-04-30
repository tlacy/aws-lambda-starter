# {{PROJECT_NAME}} — Quick Start

**Tests**: 0/0 | **Deploy**: `cd backend && bash deploy.sh` | **Frontend**: `bash deploy-frontend.sh`

## Local Dev

```bash
cd backend && npm install
cp .env.example .env   # fill in DSQL_ENDPOINT (staging) + JWT_SECRET
npm run dev            # starts on :3000
```

## Test

```bash
cd backend && npm test
```

## Deploy

```bash
# Backend — runs tests → staging → smoke → prod → smoke (all gates mandatory)
cd backend && bash deploy.sh

# Frontend — commit app.js first, then:
bash deploy-frontend.sh
```

## Key Files

| File | Purpose |
|---|---|
| `docs/AGENT_STATE.md` | Live project state — read first every session |
| `.github/copilot-instructions.md` | Agent instructions + 100+ pitfalls |
| `backend/src/app.js` | Express entry point — all routes registered here |
| `backend/src/routes/auth.js` | Auth — register, login, verify-email, reset-password |
| `backend/src/database/db.js` | DSQL connection with auto-refresh |
| `backend/smoke-test.mjs` | Smoke tests run against live API |
| `backend/production-schema-contract.json` | Schema contract — verified on every deploy |
| `database/migrations/` | SQL migration files |

## New to this project?

1. Read `docs/AGENT_STATE.md`
2. Read `.github/copilot-instructions.md`
3. Run `npm test` to confirm everything is green

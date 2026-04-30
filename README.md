# {{PROJECT_NAME}}

> Scaffolded from [aws-lambda-starter](https://github.com/tlacy/aws-lambda-starter)

**Stack**: Vanilla JS SPA → API Gateway HTTP v2 → Lambda (Node 24.x, Express) → Aurora DSQL → AWS SES

## Quick Start

```bash
# 1. Install backend deps
cd backend && npm install

# 2. Copy env file and fill in your DSQL staging endpoint + JWT secret
cp .env.example .env

# 3. Run tests
npm test

# 4. Start local server
npm run dev
```

## Deploy

```bash
# Backend (tests → staging → smoke → prod → smoke)
cd backend && bash deploy.sh

# Frontend
bash deploy-frontend.sh
```

## Tests

```
cd backend && npm test
```

Current test count: **0/0** (see `docs/AGENT_STATE.md` for live count)

## Docs

- `docs/AGENT_STATE.md` — live project state (read first when starting a new session)
- `docs/PRODUCT_ROADMAP.md` — features shipped + planned
- `SETUP.md` — initial AWS infrastructure setup
- `.github/copilot-instructions.md` — agent instructions + pitfall library

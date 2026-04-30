-- Initial Schema
-- Run with: node backend/run-dsql-migrations.mjs --cluster <hostname> --setup
-- All statements in ONE session — DSQL DDL visibility pitfall #102

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  is_admin BOOLEAN DEFAULT false,
  email_verified SMALLINT DEFAULT 0,
  verification_token VARCHAR(255),
  verification_token_expires TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX ASYNC idx_users_email ON users(email);
CREATE INDEX ASYNC idx_users_status ON users(status);

-- ─── Password Reset Tokens ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ASYNC idx_prt_token ON password_reset_tokens(token);
CREATE INDEX ASYNC idx_prt_user ON password_reset_tokens(user_id);

-- ─── Failed Login Attempts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS failed_login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  ip_address VARCHAR(45),
  attempt_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ASYNC idx_fla_email ON failed_login_attempts(email);
CREATE INDEX ASYNC idx_fla_time ON failed_login_attempts(attempt_time);

-- ─── Migrations tracking ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS migrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── Lambda role permissions (run after tables exist) ─────────────────────────
-- NOTE: Replace {{LAMBDA_IAM_ROLE}} with your actual IAM role name (not ARN)
-- pitfall #100: every new table needs explicit GRANT to Lambda role
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO "{{LAMBDA_IAM_ROLE}}";
GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO "{{LAMBDA_IAM_ROLE}}";
GRANT SELECT, INSERT, UPDATE, DELETE ON failed_login_attempts TO "{{LAMBDA_IAM_ROLE}}";
GRANT SELECT, INSERT, UPDATE, DELETE ON migrations TO "{{LAMBDA_IAM_ROLE}}";

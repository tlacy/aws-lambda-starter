// Schema contract test — validates that SQL queries in route files only reference
// columns that exist in production-schema-contract.json.
// Runs in <1s, no AWS credentials needed. Blocks deploy if violated (pitfall #40).

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(__dirname, '..', 'production-schema-contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

// Build a flat lookup: { tableName: Set<columnName> }
const tableColumns = {};
for (const [table, def] of Object.entries(contract)) {
  tableColumns[table] = new Set(Object.keys(def));
}

const routesDir = resolve(__dirname, '..', 'src', 'routes');
const routeFiles = readdirSync(routesDir).filter(f => f.endsWith('.js'));

function extractColumnRefs(src, tableName) {
  const violations = [];
  const cols = tableColumns[tableName];
  if (!cols) return violations;

  const insertRe = new RegExp(`INSERT\\s+INTO\\s+${tableName}\\s*\\(([^)]+)\\)`, 'gi');
  for (const m of src.matchAll(insertRe)) {
    const columnList = m[1].split(',').map(c => c.trim().replace(/[`'"]/g, ''));
    for (const col of columnList) {
      if (col && !cols.has(col)) {
        violations.push({ table: tableName, column: col, context: 'INSERT' });
      }
    }
  }

  const updateRe = new RegExp(`UPDATE\\s+${tableName}\\s+SET\\s+([\\s\\S]+?)(?:\\s+WHERE\\b|\\s+RETURNING\\b|$)`, 'gi');
  for (const m of src.matchAll(updateRe)) {
    const setParts = m[1].split(',').map(p => p.trim().split('=')[0].trim().replace(/[^a-z0-9_]/gi, ''));
    for (const col of setParts) {
      if (col && !/^\$\d+$/.test(col) && col.length > 0 && !cols.has(col)) {
        violations.push({ table: tableName, column: col, context: 'UPDATE SET' });
      }
    }
  }

  return violations;
}

describe('Schema Contract Validation', () => {
  it('contract file exists and has tables', () => {
    const tableNames = Object.keys(contract);
    expect(tableNames.length).toBeGreaterThan(0);
    expect(tableNames).toContain('users');
  });

  it('users table has required auth columns', () => {
    const cols = tableColumns['users'];
    for (const col of ['email', 'password_hash', 'email_verified', 'status', 'is_admin', 'verification_token']) {
      expect(cols.has(col)).toBe(true);
    }
  });

  it('no route file references non-existent columns in INSERT/UPDATE', () => {
    const allViolations = [];
    for (const file of routeFiles) {
      const src = readFileSync(resolve(routesDir, file), 'utf8');
      for (const tableName of Object.keys(tableColumns)) {
        const violations = extractColumnRefs(src, tableName);
        for (const v of violations) {
          allViolations.push(`${file}: ${v.context} ${v.table}.${v.column} — not in schema contract`);
        }
      }
    }
    if (allViolations.length > 0) {
      console.error('Schema violations:\n' + allViolations.join('\n'));
    }
    expect(allViolations).toHaveLength(0);
  });
});

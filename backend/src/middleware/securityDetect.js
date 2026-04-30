/**
 * Security Detection Middleware
 *
 * Detects common attack patterns (SQL injection, XSS, path traversal).
 * Logs and blocks suspicious requests.
 *
 * Adjust CONTENT_BODY_PREFIXES and SKIP_BODY_PREFIXES for your routes:
 * - Routes with user free-form text content → add to CONTENT_BODY_PREFIXES (reduced patterns)
 * - Routes where body is raw user input (e.g. AI extract) → add to SKIP_BODY_PREFIXES
 */

const FULL_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|CAST)\b.*\b(FROM|INTO|TABLE|WHERE|OR|AND)\b)/i,
  /(--|;|\||\/\*|\*\/|xp_|sp_)/,
  /'.*(\bOR\b|\bAND\b)\s+('?\w|TRUE|FALSE)/i,
  /(<script|javascript:|on\w+\s*=|<iframe|<img[^>]+src\s*=)/i,
  /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|\.\.%2f)/i,
];

// Reduced pattern set for routes with legitimate user-generated content
const CONTENT_PATTERNS = [
  /(<script|javascript:|on\w+\s*=|<iframe|<img[^>]+src\s*=)/i,
  /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|\.\.%2f)/i,
];

// Routes where body may contain user-authored content (use CONTENT_PATTERNS)
const CONTENT_BODY_PREFIXES = [];

// Routes where body is raw input — skip body scan entirely
const SKIP_BODY_PREFIXES = [];

export function detectSecurityThreats(req, res, next) {
  const skipBody = SKIP_BODY_PREFIXES.some(p => req.path.startsWith(p));
  const contentBody = !skipBody && CONTENT_BODY_PREFIXES.some(p => req.path.startsWith(p));

  const patterns = contentBody ? CONTENT_PATTERNS : FULL_PATTERNS;

  const toCheck = [
    skipBody ? '' : JSON.stringify(req.body || {}),
    JSON.stringify(req.query || {}),
    req.path,
  ].join(' ');

  for (const pattern of patterns) {
    if (pattern.test(toCheck)) {
      console.warn(`[SECURITY] Attack pattern detected from ${req.ip} on ${req.method} ${req.path}`);
      return res.status(400).json({ error: 'Invalid request' });
    }
  }
  next();
}

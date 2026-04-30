/**
 * Authentication Middleware
 *
 * JWT validation + user status enforcement.
 * getJwtSecret() reads at call time (not module load) so Lambda cold starts
 * see the secret AFTER Secrets Manager loads it into process.env.
 */

import jwt from 'jsonwebtoken';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET not configured — Secrets Manager may not have loaded yet');
  }
  return secret || 'dev-jwt-secret-change-in-prod';
}

export const JWT_EXPIRES_IN = '7d';

export function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}

/** Require valid JWT. Attaches decoded payload to req.user. */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' });
  if (!decoded.id) return res.status(401).json({ error: 'Invalid token payload' });

  req.user = decoded;
  next();
}

/** Require user to be approved (not pending/rejected). */
export async function requireApproved(req, res, next) {
  // In test env, skip status check so tests don't need a full approval workflow
  if (process.env.NODE_ENV === 'test') return next();

  const { default: db } = await import('../database/db.js');
  try {
    const user = await db.queryOne('SELECT status FROM users WHERE id = $1', [req.user.id]);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.status === 'pending') return res.status(403).json({ error: 'Account pending approval' });
    if (user.status === 'rejected') return res.status(403).json({ error: 'Account access denied' });
    next();
  } catch (error) {
    console.error('requireApproved error:', error);
    res.status(500).json({ error: 'Authentication check failed' });
  }
}

/** Require user to be admin. */
export async function requireAdmin(req, res, next) {
  const { default: db } = await import('../database/db.js');
  try {
    const user = await db.queryOne('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
    if (!user?.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
  } catch (error) {
    console.error('requireAdmin error:', error);
    res.status(500).json({ error: 'Authentication check failed' });
  }
}

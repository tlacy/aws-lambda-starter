/**
 * Admin Routes
 *
 * User management: list, approve, reject.
 * All routes require authenticateToken + requireAdmin.
 */

import { Router } from 'express';
import db from '../database/db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = Router();

// All admin routes require auth + admin
router.use(authenticateToken, requireAdmin);

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT status, COUNT(*) AS cnt FROM users GROUP BY status`
    );
    const stats = { total: 0, pending: 0, active: 0, rejected: 0 };
    for (const r of rows) {
      const n = parseInt(r.cnt, 10);
      stats.total += n;
      if (r.status === 'pending') stats.pending = n;
      else if (r.status === 'active') stats.active = n;
      else if (r.status === 'rejected') stats.rejected = n;
    }
    res.json({ stats });
  } catch (error) {
    console.error('GET /api/admin/stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
// List all users. Optional ?status=pending|active|rejected filter.
// Ordered: pending first, then created_at desc.
router.get('/users', async (req, res) => {
  const { status } = req.query;
  const allowed = ['pending', 'active', 'rejected'];
  try {
    let users;
    if (status && allowed.includes(status)) {
      users = await db.query(
        `SELECT id, email, name, status, email_verified, is_admin, created_at
         FROM users WHERE status = $1
         ORDER BY created_at DESC`,
        [status]
      );
    } else {
      users = await db.query(
        `SELECT id, email, name, status, email_verified, is_admin, created_at
         FROM users
         ORDER BY
           CASE WHEN status = 'pending' THEN 0
                WHEN status = 'active'  THEN 1
                ELSE 2 END,
           created_at DESC`
      );
    }
    res.json({ users });
  } catch (error) {
    console.error('GET /api/admin/users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ─── POST /api/admin/users/:id/approve ───────────────────────────────────────
router.post('/users/:id/approve', async (req, res) => {
  const { id } = req.params;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(id)) return res.status(404).json({ error: 'User not found' });

  try {
    const user = await db.queryOne(
      "UPDATE users SET status = 'active' WHERE id = $1 AND status = 'pending' RETURNING id, email, name, status",
      [id]
    );
    if (!user) return res.status(404).json({ error: 'User not found or already processed' });
    res.json({ user });
  } catch (error) {
    console.error('POST /api/admin/users/:id/approve error:', error);
    res.status(500).json({ error: 'Failed to approve user' });
  }
});

// ─── POST /api/admin/users/:id/reject ────────────────────────────────────────
router.post('/users/:id/reject', async (req, res) => {
  const { id } = req.params;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(id)) return res.status(404).json({ error: 'User not found' });

  try {
    const user = await db.queryOne(
      "UPDATE users SET status = 'rejected' WHERE id = $1 AND status = 'pending' RETURNING id, email, name, status",
      [id]
    );
    if (!user) return res.status(404).json({ error: 'User not found or already processed' });
    res.json({ user });
  } catch (error) {
    console.error('POST /api/admin/users/:id/reject error:', error);
    res.status(500).json({ error: 'Failed to reject user' });
  }
});

export default router;

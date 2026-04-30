/**
 * Express App — shared between server.js (local) and lambda.js (production)
 *
 * All routes are registered here. Both entry points import this file.
 * Pitfall #105: routes must be in app.js — shared by server.js and lambda.js.
 */

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { detectSecurityThreats } from './middleware/securityDetect.js';

import authRouter from './routes/auth.js';

const app = express();

// ─── Trust proxy (required behind API Gateway / Lambda) ───────────────────────
app.set('trust proxy', 1);

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'https://{{DOMAIN}}',
  'https://www.{{DOMAIN}}',
  'http://localhost:8080',
  'http://localhost:3000',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.options('*', cors());

// ─── Body parsing ──────────────────────────────────────────────────────────────
const bodyLimit = process.env.BODY_SIZE_LIMIT || '10mb';
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

// ─── Security middleware ───────────────────────────────────────────────────────
app.use(detectSecurityThreats);

// ─── Rate limiting (externalized as env vars — pitfall #107) ──────────────────
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX || '300', 10);
const rateLimitWindow = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);

const generalLimiter = rateLimit({
  windowMs: rateLimitWindow,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later' },
});
app.use(generalLimiter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: '{{PROJECT_SLUG}}-api' }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
// Add your routes here:
// import myRouter from './routes/my-feature.js';
// app.use('/api/my-feature', myRouter);

// ─── 404 catch-all ────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Not allowed' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

export default app;

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config.js';
import { pool } from './db/index.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import catalogRoutes from './routes/catalog.js';
import contactRoutes from './routes/contacts.js';
import inventoryRoutes from './routes/inventory.js';
import salesRoutes from './routes/sales.js';
import purchaseRoutes from './routes/purchases.js';
import cashRoutes from './routes/cash.js';
import accountingRoutes from './routes/accounting.js';
import reportRoutes from './routes/reports.js';
import dashboardRoutes from './routes/dashboard.js';
import settingsRoutes from './routes/settings.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()), credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.' },
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'ledger-pos', time: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false, error: 'Database unavailable' });
  }
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth', authRoutes);

const api = express.Router();
api.use(authenticate);
api.use('/dashboard', dashboardRoutes);
api.use('/users', userRoutes);
api.use('/reports', reportRoutes);
api.use('/settings', settingsRoutes);
api.use('/', catalogRoutes);
api.use('/', contactRoutes);
api.use('/', inventoryRoutes);
api.use('/', salesRoutes);
api.use('/', purchaseRoutes);
api.use('/', cashRoutes);
api.use('/', accountingRoutes);
app.use('/api', api);

// Production: serve the built React app from client/dist.
if (config.nodeEnv === 'production') {
  const dist = fileURLToPath(new URL('../../client/dist', import.meta.url));
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }
}

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`[api] Ledger POS running on http://localhost:${config.port} (${config.nodeEnv})`);
});

async function shutdown(signal) {
  console.log(`[api] ${signal} received, shutting down…`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;

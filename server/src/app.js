import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth, requireRole, FINANCE } from './lib/auth.js';
import authRoutes from './routes/auth.js';
import companyRoutes from './routes/company.js';
import staffRoutes from './routes/staff.js';
import clientRoutes from './routes/clients.js';
import shipmentRoutes from './routes/shipments.js';
import expenseRoutes from './routes/expenses.js';
import fileRoutes from './routes/files.js';
import docRoutes from './routes/docs.js';
import packingRoutes from './routes/packing.js';
import messageRoutes from './routes/messages.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import publicRoutes from './routes/public.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'img-src': ["'self'", 'data:', 'blob:'], 'frame-src': ["'self'", 'blob:'], 'object-src': ["'self'", 'blob:'] } } }));
  const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origins.length) app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, app: 'Brukline' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/company', requireAuth, companyRoutes);
  app.use('/api/staff', requireAuth, staffRoutes);
  app.use('/api/clients', requireAuth, requireRole(...FINANCE), clientRoutes);
  app.use('/api/shipments', requireAuth, shipmentRoutes);
  app.use('/api/expenses', requireAuth, expenseRoutes);
  app.use('/api', requireAuth, fileRoutes); // /api/shipments/:id/files, /api/files/:fileId/...
  app.use('/api/docs', requireAuth, requireRole(...FINANCE), docRoutes);
  app.use('/api/packing-lists', requireAuth, packingRoutes);
  app.use('/api/messages', requireAuth, messageRoutes);
  app.use('/api/dashboard', requireAuth, dashboardRoutes);
  app.use('/api/reports', requireAuth, requireRole(...FINANCE), reportRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built React app in production (npm run build).
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.code === 'P2002') return res.status(409).json({ error: 'That record already exists (check the email or number)' });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    if (err.code === 'P2003') return res.status(400).json({ error: 'This record is still in use' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });
  return app;
}

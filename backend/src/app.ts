import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import connectionsRouter from './routes/connections.js';
import queryRouter from './routes/query.js';
import historyRouter from './routes/history.js';
import schemaRouter from './routes/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
  app.use(
    cors({
      origin: corsOrigin === '*' ? true : corsOrigin,
    })
  );
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'sql-playground',
      engines: ['sqlite', 'duckdb', 'postgresql', 'mysql'],
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/connections', connectionsRouter);
  app.use('/api/query', queryRouter);
  app.use('/api/history', historyRouter);
  app.use('/api/schema', schemaRouter);

  // Production / Docker: serve the Vite build from ../frontend/dist
  if (process.env.SERVE_STATIC === 'true') {
    const staticCandidates = [
      process.env.STATIC_DIR,
      path.resolve(__dirname, '../../frontend/dist'),
      path.resolve(__dirname, '../../../frontend/dist'),
      path.resolve(process.cwd(), '../frontend/dist'),
    ].filter(Boolean) as string[];

    const staticDir = staticCandidates.find((d) => fs.existsSync(path.join(d, 'index.html')));
    if (staticDir) {
      app.use(express.static(staticDir));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(staticDir, 'index.html'));
      });
      console.log(`  Serving UI from ${staticDir}`);
    } else {
      console.warn('  SERVE_STATIC=true but frontend dist not found');
    }
  }

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error(err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  );

  return app;
}

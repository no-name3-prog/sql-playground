import { Router } from 'express';
import { connectionService } from '../services/connectionService.js';
import type { CreateConnectionInput } from '../types/index.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ connections: connectionService.list() });
});

router.get('/:id', (req, res) => {
  const conn = connectionService.get(req.params.id);
  if (!conn) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }
  res.json({ connection: conn });
});

router.post('/', async (req, res) => {
  try {
    const input = req.body as CreateConnectionInput;
    const connection = await connectionService.create(input, true);
    res.status(201).json({ connection });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to create connection',
    });
  }
});

router.post('/test', async (req, res) => {
  try {
    const input = req.body as CreateConnectionInput;
    // create temporarily, test, then remove if not wanted — just test via create + remove
    const connection = await connectionService.create(input, true);
    await connectionService.remove(connection.id);
    res.json({ ok: true, message: 'Connection successful' });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Connection test failed',
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const ok = await connectionService.remove(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to delete connection',
    });
  }
});

export default router;

import { Router } from 'express';
import { historyService } from '../services/historyService.js';

const router = Router();

router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ history: historyService.list(limit) });
});

router.delete('/', (_req, res) => {
  historyService.clear();
  res.json({ ok: true });
});

export default router;

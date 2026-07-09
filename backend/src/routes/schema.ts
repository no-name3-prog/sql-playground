import { Router } from 'express';
import { connectionService } from '../services/connectionService.js';

const router = Router();

/** Full interactive catalog + relationship graph */
router.get('/:connectionId/catalog', async (req, res) => {
  try {
    const driver = await connectionService.getDriver(req.params.connectionId);
    const catalog = await driver.getCatalog();
    res.json({ catalog });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to load catalog',
    });
  }
});

/** Object metadata + sample rows + statistics */
router.get('/:connectionId/objects/:name', async (req, res) => {
  try {
    const driver = await connectionService.getDriver(req.params.connectionId);
    const kind = (req.query.kind as 'table' | 'view') || 'table';
    const details = await driver.getObjectDetails(req.params.name, kind);
    res.json({ details });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to load object details',
    });
  }
});

export default router;

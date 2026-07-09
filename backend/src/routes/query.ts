import { Router } from 'express';
import { queryService } from '../services/queryService.js';
import { connectionService } from '../services/connectionService.js';
import type { AnalyzeQueryRequest, ExecuteQueryRequest } from '../types/index.js';

const router = Router();

router.post('/execute', async (req, res) => {
  try {
    const body = req.body as ExecuteQueryRequest;
    if (!body.connectionId) {
      res.status(400).json({ success: false, error: { message: 'connectionId is required' } });
      return;
    }
    const response = await queryService.execute(body);
    res.status(response.success ? 200 : 400).json(response);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { message: err instanceof Error ? err.message : 'Internal error' },
    });
  }
});

router.post('/analyze', async (req, res) => {
  try {
    const body = req.body as AnalyzeQueryRequest;
    if (!body.connectionId) {
      res.status(400).json({ success: false, error: { message: 'connectionId is required' } });
      return;
    }
    const response = await queryService.analyze(body);
    res.status(response.success ? 200 : 400).json(response);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { message: err instanceof Error ? err.message : 'Internal error' },
    });
  }
});

router.post('/optimize', async (req, res) => {
  try {
    const body = req.body as AnalyzeQueryRequest;
    if (!body.connectionId) {
      res.status(400).json({ success: false, error: { message: 'connectionId is required' } });
      return;
    }
    const response = await queryService.optimize(body);
    res.status(response.success ? 200 : 400).json(response);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { message: err instanceof Error ? err.message : 'Internal error' },
    });
  }
});

router.get('/schema/:connectionId', async (req, res) => {
  try {
    const driver = await connectionService.getDriver(req.params.connectionId);
    const schema = await driver.getSchema();
    res.json({ schema });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to load schema',
    });
  }
});

export default router;

import { Router } from 'express';
import { asyncHandler } from '../utils.js';
import { dashboard } from '../services/dashboard.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json(await dashboard(req.user, req.query.view));
}));

export default router;

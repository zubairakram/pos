import { Router } from 'express';
import { query, withTransaction } from '../db/index.js';
import { requireRole } from '../middleware/auth.js';
import { getSettings, saveSetting } from '../services/settings.js';
import { audit, asyncHandler, assert } from '../utils.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const { rows } = await query(
    `SELECT m.key, a.id, a.code, a.name, a.type FROM accounts a
     JOIN account_mappings m ON m.account_id = a.id ORDER BY m.key`
  );
  res.json({ settings, mapped_accounts: rows });
}));

router.put('/', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const allowed = ['company', 'pos', 'accounting'];
  await withTransaction(async (client) => {
    for (const key of allowed) {
      if (body[key] && typeof body[key] === 'object') {
        await saveSetting(client, key, body[key]);
      }
    }
    await audit(client, req, 'settings.update', 'settings', null, body);
  });
  res.json({ settings: await getSettings() });
}));

export default router;

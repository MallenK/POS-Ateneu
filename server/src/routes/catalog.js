import { Router } from 'express';
import { pool } from '../config/db.js';
import { asyncHandler } from '../utils/httpError.js';

const router = Router();

router.get('/', asyncHandler(async (_req, res) => {
  const [categories] = await pool.query(`SELECT id, name FROM categories WHERE active = 1 ORDER BY sort_order, name`);
  const [products] = await pool.query(
    `SELECT id, category_id, name, price, tax_rate, stock FROM products WHERE active = 1 ORDER BY name`,
  );
  res.json({ categories, products });
}));

export default router;

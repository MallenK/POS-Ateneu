import { pool, withTransaction } from '../config/db.js';
import { HttpError } from '../utils/httpError.js';
import { fromCents, toCents } from '../utils/money.js';

async function summary(conn, register) {
  const [rows] = await conn.query(
    `SELECT method, COALESCE(SUM(amount), 0) AS total FROM payments
      WHERE cash_register_id = ? GROUP BY method`,
    [register.id],
  );
  const cash = toCents(rows.find((r) => r.method === 'cash')?.total || 0);
  const card = toCents(rows.find((r) => r.method === 'card')?.total || 0);
  const [[{ open_tickets }]] = await conn.query(
    `SELECT COUNT(*) AS open_tickets FROM tickets WHERE cash_register_id = ? AND status = 'open'`,
    [register.id],
  );
  return {
    cash_sales: fromCents(cash),
    card_sales: fromCents(card),
    total_sales: fromCents(cash + card),
    expected_cash: fromCents(toCents(register.initial_amount) + cash),
    open_tickets,
  };
}

export async function getCurrent() {
  const [[register]] = await pool.query(`SELECT * FROM cash_registers WHERE status = 'open'`);
  if (!register) return null;
  return { ...register, summary: await summary(pool, register) };
}

export async function open(initialAmount) {
  const cents = toCents(initialAmount ?? 0);
  if (!Number.isFinite(cents) || cents < 0) throw new HttpError(400, 'Fondo inicial no válido');
  try {
    await pool.query(`INSERT INTO cash_registers (initial_amount) VALUES (?)`, [fromCents(cents)]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'Ya hay una caja abierta');
    throw err;
  }
  return getCurrent();
}

export async function close(finalAmount) {
  const finalCents = toCents(finalAmount);
  if (!Number.isFinite(finalCents) || finalCents < 0) throw new HttpError(400, 'Importe contado no válido');

  return withTransaction(async (conn) => {
    const [[register]] = await conn.query(`SELECT * FROM cash_registers WHERE status = 'open' FOR UPDATE`);
    if (!register) throw new HttpError(409, 'No hay ninguna caja abierta');

    const s = await summary(conn, register);
    if (s.open_tickets > 0) {
      throw new HttpError(409, `Hay ${s.open_tickets} ticket(s) sin cobrar. Ciérralos antes del arqueo.`);
    }
    const expectedCents = toCents(s.expected_cash);
    await conn.query(
      `UPDATE cash_registers SET status = 'closed', closed_at = NOW(), final_amount = ?,
              expected_amount = ?, difference = ? WHERE id = ?`,
      [fromCents(finalCents), fromCents(expectedCents), fromCents(finalCents - expectedCents), register.id],
    );
    const [[closed]] = await conn.query(`SELECT * FROM cash_registers WHERE id = ?`, [register.id]);
    return { ...closed, summary: s };
  });
}

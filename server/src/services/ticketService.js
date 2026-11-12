import { pool, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';
import { fromCents, toCents } from '../utils/money.js';
import * as verifacti from './verifactiService.js';

export async function getTicket(id, conn = pool) {
  const [[ticket]] = await conn.query(`SELECT * FROM tickets WHERE id = ?`, [id]);
  if (!ticket) throw new HttpError(404, 'Ticket no encontrado');
  const [items] = await conn.query(`SELECT * FROM ticket_items WHERE ticket_id = ? ORDER BY id`, [id]);
  const [payments] = await conn.query(`SELECT * FROM payments WHERE ticket_id = ? ORDER BY id`, [id]);
  const paid = payments.reduce((sum, p) => sum + toCents(p.amount), 0);
  return {
    ...ticket,
    invoice_number: ticket.series ? `${ticket.series}-${ticket.number}` : null,
    items,
    payments,
    paid_amount: fromCents(paid),
    pending_amount: fromCents(toCents(ticket.total_amount) - paid),
  };
}

export async function listOpen() {
  const [rows] = await pool.query(
    `SELECT t.id, t.table_number, t.total_amount, t.created_at,
            COALESCE((SELECT SUM(amount) FROM payments p WHERE p.ticket_id = t.id), 0) AS paid_amount
       FROM tickets t WHERE t.status = 'open' ORDER BY t.created_at`,
  );
  return rows;
}

/** Siguiente número correlativo de la serie. El bloqueo de fila evita duplicados y huecos. */
async function allocateNumber(conn, series) {
  await conn.query(`INSERT IGNORE INTO invoice_series (series) VALUES (?)`, [series]);
  const [[row]] = await conn.query(`SELECT next_number FROM invoice_series WHERE series = ? FOR UPDATE`, [series]);
  await conn.query(`UPDATE invoice_series SET next_number = next_number + 1 WHERE series = ?`, [series]);
  return row.next_number;
}

function validatePayments(payments) {
  if (!Array.isArray(payments)) throw new HttpError(400, 'payments debe ser una lista');
  return payments.map((p) => {
    const cents = toCents(p.amount);
    if (!['cash', 'card'].includes(p.method)) throw new HttpError(400, 'Método de pago no válido');
    if (!Number.isInteger(cents) || cents <= 0) throw new HttpError(400, 'Importe de pago no válido');
    return { method: p.method, cents };
  });
}

/**
 * Registra pagos sobre un ticket abierto (misma transacción que quien llama).
 * Cuando queda totalmente cobrado: numera la factura y encola su envío a Verifacti.
 * @returns {boolean} true si el ticket ha quedado cobrado por completo
 */
async function applyPayments(conn, ticket, payments) {
  if (!payments.length) return false;

  const [[{ paid }]] = await conn.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE ticket_id = ?`,
    [ticket.id],
  );
  const totalCents = toCents(ticket.total_amount);
  const newPaid = toCents(paid) + payments.reduce((sum, p) => sum + p.cents, 0);
  if (newPaid > totalCents) throw new HttpError(400, 'Los pagos superan el importe pendiente');

  await conn.query(`INSERT INTO payments (ticket_id, cash_register_id, method, amount) VALUES ?`, [
    payments.map((p) => [ticket.id, ticket.cash_register_id, p.method, fromCents(p.cents)]),
  ]);
  if (newPaid < totalCents) return false;

  const [methods] = await conn.query(`SELECT DISTINCT method FROM payments WHERE ticket_id = ?`, [ticket.id]);
  const series = ticket.invoice_type === 'full' ? env.series.full : env.series.simplified;
  const number = await allocateNumber(conn, series);
  await conn.query(
    `UPDATE tickets SET status = 'paid', series = ?, number = ?, issued_at = NOW(),
            payment_method = ?, verifacti_status = 'pending' WHERE id = ?`,
    [series, number, methods.length > 1 ? 'mixed' : methods[0].method, ticket.id],
  );

  const [[issued]] = await conn.query(`SELECT * FROM tickets WHERE id = ?`, [ticket.id]);
  const [items] = await conn.query(`SELECT * FROM ticket_items WHERE ticket_id = ?`, [ticket.id]);
  let customer = null;
  if (issued.customer_id) {
    [[customer]] = await conn.query(`SELECT * FROM customers WHERE id = ?`, [issued.customer_id]);
  }
  await verifacti.enqueue(conn, ticket.id, verifacti.buildPayload(issued, items, customer));
  return true;
}

async function upsertCustomer(conn, customer) {
  const nif = String(customer?.nif || '').trim().toUpperCase();
  const name = String(customer?.name || '').trim();
  if (!nif || !name) throw new HttpError(400, 'La factura completa requiere NIF y nombre del cliente');
  await conn.query(
    `INSERT INTO customers (nif, name, address, postal_code, city) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address),
                             postal_code = VALUES(postal_code), city = VALUES(city)`,
    [nif, name, customer.address || null, customer.postal_code || null, customer.city || null],
  );
  const [[row]] = await conn.query(`SELECT id FROM customers WHERE nif = ?`, [nif]);
  return row.id;
}

/**
 * Crea un ticket. Con `payments` que cubran el total queda cobrado y emitido;
 * con pagos parciales o sin pagos queda abierto (mesa pendiente).
 */
export async function createTicket({ items, table_number, invoice_type = 'simplified', customer, payments = [] }) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'El ticket no tiene líneas');
  if (!['simplified', 'full'].includes(invoice_type)) throw new HttpError(400, 'Tipo de factura no válido');
  const validPayments = validatePayments(payments);

  // Agrupa cantidades por producto.
  const quantities = new Map();
  for (const item of items) {
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(400, 'Cantidad no válida');
    quantities.set(Number(item.product_id), (quantities.get(Number(item.product_id)) || 0) + qty);
  }

  const { ticketId, paid } = await withTransaction(async (conn) => {
    const [[register]] = await conn.query(`SELECT id FROM cash_registers WHERE status = 'open' FOR UPDATE`);
    if (!register) throw new HttpError(409, 'No hay caja abierta. Abre la caja para vender.');

    // Los precios se leen siempre de la BD: nunca se confía en los que envía el cliente.
    const ids = [...quantities.keys()];
    const [products] = await conn.query(`SELECT * FROM products WHERE id IN (?) AND active = 1 FOR UPDATE`, [ids]);
    if (products.length !== ids.length) throw new HttpError(400, 'Algún producto no existe o no está activo');

    let totalCents = 0;
    const lines = products.map((p) => {
      const quantity = quantities.get(p.id);
      if (p.stock !== null && p.stock < quantity) throw new HttpError(409, `Stock insuficiente: ${p.name}`);
      const subtotalCents = toCents(p.price) * quantity;
      totalCents += subtotalCents;
      return { product: p, quantity, subtotalCents };
    });

    const customerId = invoice_type === 'full' ? await upsertCustomer(conn, customer) : null;

    const [result] = await conn.query(
      `INSERT INTO tickets (cash_register_id, table_number, customer_id, invoice_type, total_amount)
       VALUES (?, ?, ?, ?, ?)`,
      [register.id, table_number ? String(table_number) : null, customerId, invoice_type, fromCents(totalCents)],
    );
    const id = result.insertId;

    await conn.query(
      `INSERT INTO ticket_items (ticket_id, product_id, product_name, quantity, unit_price, tax_rate, subtotal)
       VALUES ?`,
      [lines.map((l) => [id, l.product.id, l.product.name, l.quantity, l.product.price, l.product.tax_rate, fromCents(l.subtotalCents)])],
    );
    for (const l of lines) {
      if (l.product.stock !== null) {
        await conn.query(`UPDATE products SET stock = stock - ? WHERE id = ?`, [l.quantity, l.product.id]);
      }
    }

    const [[ticket]] = await conn.query(`SELECT * FROM tickets WHERE id = ?`, [id]);
    return { ticketId: id, paid: await applyPayments(conn, ticket, validPayments) };
  });

  // Fuera de la transacción: el cobro ya está guardado aunque Verifacti no responda.
  if (paid) await verifacti.processTicket(ticketId);
  return getTicket(ticketId);
}

/** Añade pagos a un ticket abierto (cobro parcial). */
export async function addPayments(ticketId, payments) {
  const validPayments = validatePayments(payments);
  if (!validPayments.length) throw new HttpError(400, 'No hay pagos');

  const paid = await withTransaction(async (conn) => {
    const [[ticket]] = await conn.query(`SELECT * FROM tickets WHERE id = ? FOR UPDATE`, [ticketId]);
    if (!ticket) throw new HttpError(404, 'Ticket no encontrado');
    if (ticket.status !== 'open') throw new HttpError(409, 'El ticket no está abierto');
    const [[register]] = await conn.query(`SELECT id FROM cash_registers WHERE status = 'open'`);
    if (!register) throw new HttpError(409, 'No hay caja abierta');
    // El pago se imputa a la caja abierta en el momento del cobro.
    return applyPayments(conn, { ...ticket, cash_register_id: register.id }, validPayments);
  });

  if (paid) await verifacti.processTicket(ticketId);
  return getTicket(ticketId);
}

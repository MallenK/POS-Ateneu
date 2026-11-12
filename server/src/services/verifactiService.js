/**
 * Adaptador de la API de Verifacti (VeriFactu).
 *
 * Único punto del backend que conoce el formato de Verifacti. El resto de la app trabaja con
 * tickets propios y llama a: buildPayload → enqueue (dentro de la transacción de cobro) →
 * processTicket (envío inmediato) y processQueue (reintentos desde el worker).
 *
 * Estado de verificación contra la documentación pública (https://www.verifacti.com/docs):
 *   CONFIRMADO   POST /verifactu/create con serie, numero, fecha_expedicion, tipo_factura,
 *                lineas, importe_total; cabecera Idempotency-Key (409 en curso, 422 payload
 *                distinto); 401 si la API key no es válida; POST /verifactu/status.
 *   SIN VERIFICAR (revisar contra el OpenAPI antes de producción; marcado con "VERIFICAR"):
 *                URL base, formato de fecha, campos de cada línea, campos del destinatario,
 *                descripción y nombres de los campos de la respuesta (qr, url, huella, uuid).
 */
import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { fromCents, toCents, taxBreakdown } from '../utils/money.js';

const BACKOFF_BASE_MS = 15_000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;
const STUCK_PROCESSING_MINUTES = 5;

export class VerifactiError extends Error {
  /** @param {boolean} retryable true = fallo transitorio (red, timeout, 5xx, 429) */
  constructor(message, { retryable, status = null, body = null } = {}) {
    super(message);
    this.name = 'VerifactiError';
    this.retryable = retryable;
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Mapeo ticket → Verifacti
// ---------------------------------------------------------------------------

// VERIFICAR: formato de fecha que espera la API.
function formatDate(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/**
 * Construye el cuerpo de POST /verifactu/create.
 * @param {object} ticket   fila de `tickets` ya numerada (series, number, issued_at)
 * @param {object[]} items  filas de `ticket_items`
 * @param {object|null} customer fila de `customers` (obligatoria en factura completa)
 */
export function buildPayload(ticket, items, customer = null) {
  const breakdown = taxBreakdown(
    items.map((i) => ({ subtotalCents: toCents(i.subtotal), taxRate: Number(i.tax_rate) })),
  );

  const payload = {
    serie: ticket.series,
    numero: String(ticket.number),
    fecha_expedicion: formatDate(ticket.issued_at),
    // F1 = factura completa, F2 = factura simplificada.
    tipo_factura: ticket.invoice_type === 'full' ? 'F1' : 'F2',
    descripcion: 'Servicios de hostelería', // VERIFICAR
    // VERIFICAR: nombres de los campos de cada línea (una por tipo de IVA).
    lineas: breakdown.map((b) => ({
      base_imponible: fromCents(b.baseCents),
      tipo_impositivo: String(b.taxRate),
      cuota_repercutida: fromCents(b.taxCents),
    })),
    importe_total: fromCents(toCents(ticket.total_amount)),
  };

  if (ticket.invoice_type === 'full') {
    if (!customer) throw new Error('Una factura completa requiere datos de cliente');
    // VERIFICAR: nombres de los campos del destinatario.
    payload.nif = customer.nif;
    payload.nombre = customer.name;
  }
  return payload;
}

// VERIFICAR: nombres de los campos de la respuesta.
function normalizeResponse(data) {
  return {
    uuid: data.uuid ?? null,
    qrData: data.qr ?? null,
    qrUrl: data.url ?? null,
    hash: data.huella ?? null,
    raw: data,
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function request(path, body, { idempotencyKey } = {}) {
  if (!env.verifacti.apiKey) {
    throw new VerifactiError('VERIFACTI_API_KEY no configurada', { retryable: true });
  }

  let res;
  try {
    res = await fetch(`${env.verifacti.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.verifacti.apiKey}`,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.verifacti.timeoutMs),
    });
  } catch (err) {
    // Sin conexión, DNS, timeout…: el establecimiento está offline o Verifacti no responde.
    throw new VerifactiError(`Sin conexión con Verifacti: ${err.message}`, { retryable: true });
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no JSON */
  }

  if (res.ok) return data ?? {};

  // 409 = otra petición con la misma Idempotency-Key en curso → reintentar más tarde.
  const retryable = res.status >= 500 || [408, 409, 429].includes(res.status);
  const detail = data?.error || data?.message || text.slice(0, 300) || res.statusText;
  throw new VerifactiError(`Verifacti HTTP ${res.status}: ${detail}`, {
    retryable,
    status: res.status,
    body: data,
  });
}

/** Respuesta simulada para desarrollo (VERIFACTI_MOCK=true). No es un registro fiscal real. */
function mockCreate(payload) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').toUpperCase();
  return {
    uuid: crypto.randomUUID(),
    estado: 'Pendiente',
    url: `https://mock.invalid/qr?numserie=${payload.serie}${payload.numero}&importe=${payload.importe_total}`,
    qr: null,
    huella: hash,
  };
}

/** Envía una factura. Lanza VerifactiError (con `.retryable`) si falla. */
export async function sendInvoice(payload, idempotencyKey) {
  const data = env.verifacti.mock
    ? mockCreate(payload)
    : await request('/verifactu/create', payload, { idempotencyKey });
  return normalizeResponse(data);
}

/** Consulta el estado de un registro en la AEAT. Devuelve la respuesta sin transformar. */
export async function checkStatus({ serie, numero, fecha_expedicion }) {
  if (env.verifacti.mock) return { estado: 'Correcto', mock: true };
  return request('/verifactu/status', { serie, numero, fecha_expedicion });
}

// ---------------------------------------------------------------------------
// Cola persistente (fallback offline + reintentos)
// ---------------------------------------------------------------------------

/**
 * Encola el envío. Debe llamarse con la conexión de la transacción de cobro: así la factura
 * numerada y su envío pendiente se guardan de forma atómica y nunca se pierde un registro.
 */
export async function enqueue(conn, ticketId, payload) {
  await conn.query(
    `INSERT INTO verifacti_queue (ticket_id, payload, idempotency_key) VALUES (?, ?, ?)`,
    [ticketId, JSON.stringify(payload), crypto.randomUUID()],
  );
}

const backoffMs = (attempts) => Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS);

/** Reclama el job de forma atómica para que dos procesos no envíen la misma factura. */
async function claim(jobId) {
  const [r] = await pool.query(
    `UPDATE verifacti_queue SET status = 'processing', attempts = attempts + 1
      WHERE id = ? AND status = 'pending'`,
    [jobId],
  );
  return r.affectedRows === 1;
}

async function runJob(job) {
  if (!(await claim(job.id))) return { status: 'skipped' };
  const attempts = job.attempts + 1;
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;

  try {
    const result = await sendInvoice(payload, job.idempotency_key);
    await pool.query(
      `UPDATE tickets SET verifacti_status = 'sent', verifacti_uuid = ?, qr_data = ?, qr_url = ?,
              hash = ?, verifacti_error = NULL WHERE id = ?`,
      [result.uuid, result.qrData, result.qrUrl, result.hash, job.ticket_id],
    );
    await pool.query(`UPDATE verifacti_queue SET status = 'done', last_error = NULL WHERE id = ?`, [job.id]);
    return { status: 'sent' };
  } catch (err) {
    const message = String(err.message).slice(0, 500);
    const retryable = err instanceof VerifactiError ? err.retryable : true;

    if (retryable) {
      // Fallo transitorio: se reintenta indefinidamente con backoff exponencial (máx. 1 h).
      await pool.query(
        `UPDATE verifacti_queue SET status = 'pending', last_error = ?,
                next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id = ?`,
        [message, Math.round(backoffMs(attempts) / 1000), job.id],
      );
      await pool.query(`UPDATE tickets SET verifacti_error = ? WHERE id = ?`, [message, job.ticket_id]);
      return { status: 'pending', error: message };
    }

    // Rechazo definitivo (datos inválidos, 4xx): reintentar no lo arregla, requiere revisión manual.
    await pool.query(`UPDATE verifacti_queue SET status = 'failed', last_error = ? WHERE id = ?`, [message, job.id]);
    await pool.query(
      `UPDATE tickets SET verifacti_status = 'rejected', verifacti_error = ? WHERE id = ?`,
      [message, job.ticket_id],
    );
    console.error(`[verifacti] ticket ${job.ticket_id} rechazado: ${message}`);
    return { status: 'rejected', error: message };
  }
}

/** Intenta enviar ya el ticket indicado (tras el cobro). Nunca lanza: si falla, queda en cola. */
export async function processTicket(ticketId) {
  try {
    const [[job]] = await pool.query(
      `SELECT * FROM verifacti_queue WHERE ticket_id = ? AND status = 'pending'`,
      [ticketId],
    );
    return job ? await runJob(job) : { status: 'skipped' };
  } catch (err) {
    console.error(`[verifacti] error procesando ticket ${ticketId}:`, err.message);
    return { status: 'pending', error: err.message };
  }
}

/** Procesa los envíos vencidos. Lo invoca el worker periódicamente. */
export async function processQueue(limit = 20) {
  // Recupera jobs que quedaron en 'processing' por una caída del proceso.
  await pool.query(
    `UPDATE verifacti_queue SET status = 'pending'
      WHERE status = 'processing' AND updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [STUCK_PROCESSING_MINUTES],
  );
  // Orden por id: las facturas se envían en el mismo orden en que se emitieron.
  const [jobs] = await pool.query(
    `SELECT * FROM verifacti_queue WHERE status = 'pending' AND next_attempt_at <= NOW()
      ORDER BY id LIMIT ?`,
    [limit],
  );
  const results = [];
  for (const job of jobs) {
    const result = await runJob(job);
    results.push(result);
    // Si no hay conexión, no tiene sentido seguir con el resto en esta pasada.
    if (result.status === 'pending') break;
  }
  return results;
}

/** Reencola manualmente un ticket rechazado tras corregir el problema. */
export async function retryRejected(ticketId) {
  const [r] = await pool.query(
    `UPDATE verifacti_queue SET status = 'pending', next_attempt_at = NOW()
      WHERE ticket_id = ? AND status = 'failed'`,
    [ticketId],
  );
  if (r.affectedRows) {
    await pool.query(`UPDATE tickets SET verifacti_status = 'pending' WHERE id = ?`, [ticketId]);
  }
  return processTicket(ticketId);
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { formatEUR, fromCents, splitEvenly, toCents } from '../utils/money.js';

const TABLES = Array.from({ length: 12 }, (_, i) => String(i + 1));
const METHOD_LABEL = { cash: 'Efectivo', card: 'Tarjeta' };

const btn = 'rounded-xl font-semibold transition active:scale-95 disabled:opacity-40 disabled:active:scale-100';

// ---------------------------------------------------------------------------
// Piezas de interfaz
// ---------------------------------------------------------------------------

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4">
      <div className="max-h-full w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          {onClose && (
            <button onClick={onClose} className={`${btn} h-12 w-12 bg-slate-100 text-2xl`} aria-label="Cerrar">
              ×
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function AmountInput({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0,00"
        className="mt-1 h-14 w-full rounded-xl border border-slate-300 px-4 text-right text-2xl font-semibold"
      />
    </label>
  );
}

function CashRegisterModal({ register, onClose, onChanged }) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(null);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const value = fromCents(toCents(amount || 0));
      if (register) setClosed(await api.closeCashRegister(value));
      else {
        await api.openCashRegister(value);
        onClose();
      }
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (closed) {
    const diff = toCents(closed.difference);
    return (
      <Modal title="Caja cerrada" onClose={onClose}>
        <dl className="space-y-2 text-lg">
          <Row label="Efectivo esperado" value={formatEUR(toCents(closed.expected_amount))} />
          <Row label="Efectivo contado" value={formatEUR(toCents(closed.final_amount))} />
          <Row
            label="Descuadre"
            value={formatEUR(diff)}
            className={diff === 0 ? 'text-emerald-600' : 'text-red-600'}
          />
        </dl>
      </Modal>
    );
  }

  const s = register?.summary;
  return (
    <Modal title={register ? 'Cierre y arqueo de caja' : 'Abrir caja'} onClose={onClose}>
      {s && (
        <dl className="mb-4 space-y-2 rounded-xl bg-slate-50 p-4">
          <Row label="Fondo inicial" value={formatEUR(toCents(register.initial_amount))} />
          <Row label="Ventas en efectivo" value={formatEUR(toCents(s.cash_sales))} />
          <Row label="Ventas con tarjeta" value={formatEUR(toCents(s.card_sales))} />
          <Row label="Efectivo esperado en caja" value={formatEUR(toCents(s.expected_cash))} className="font-bold" />
        </dl>
      )}
      <AmountInput label={register ? 'Efectivo contado' : 'Fondo inicial'} value={amount} onChange={setAmount} />
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <button
        onClick={submit}
        disabled={busy || (register && amount === '')}
        className={`${btn} mt-4 h-16 w-full text-xl text-white ${register ? 'bg-red-600' : 'bg-emerald-600'}`}
      >
        {register ? 'Cerrar caja' : 'Abrir caja'}
      </button>
    </Modal>
  );
}

function Row({ label, value, className = '' }) {
  return (
    <div className={`flex justify-between ${className}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** Cobro: una sola forma de pago o cuenta dividida en N partes, cada una con su método. */
function CheckoutModal({ totalCents, busy, error, onConfirm, onClose }) {
  const [parts, setParts] = useState(1);
  const [methods, setMethods] = useState(['cash']);
  const [received, setReceived] = useState('');

  const amounts = useMemo(() => splitEvenly(totalCents, parts), [totalCents, parts]);
  const changeParts = (n) => {
    setParts(n);
    setMethods((prev) => Array.from({ length: n }, (_, i) => prev[i] || 'cash'));
  };
  const setMethod = (i, method) => setMethods((prev) => prev.map((m, idx) => (idx === i ? method : m)));

  const receivedCents = received ? toCents(received) : 0;
  const changeCents = parts === 1 && methods[0] === 'cash' && receivedCents > totalCents ? receivedCents - totalCents : 0;

  return (
    <Modal title={`Cobrar ${formatEUR(totalCents)}`} onClose={busy ? null : onClose}>
      <p className="mb-2 text-sm font-medium text-slate-600">Dividir la cuenta entre</p>
      <div className="mb-4 grid grid-cols-6 gap-2">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            onClick={() => changeParts(n)}
            className={`${btn} h-14 text-xl ${parts === n ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}
          >
            {n}
          </button>
        ))}
      </div>

      <ul className="space-y-2">
        {amounts.map((cents, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-28 text-lg font-semibold tabular-nums">
              {parts > 1 && <span className="mr-1 text-sm font-normal text-slate-500">{i + 1}.</span>}
              {formatEUR(cents)}
            </span>
            {Object.entries(METHOD_LABEL).map(([method, label]) => (
              <button
                key={method}
                onClick={() => setMethod(i, method)}
                className={`${btn} h-14 flex-1 text-lg ${
                  methods[i] === method ? 'bg-blue-600 text-white' : 'bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </li>
        ))}
      </ul>

      {parts === 1 && methods[0] === 'cash' && (
        <div className="mt-4">
          <AmountInput label="Entregado (opcional)" value={received} onChange={setReceived} />
          {changeCents > 0 && (
            <p className="mt-2 text-right text-xl font-bold text-emerald-600">Cambio: {formatEUR(changeCents)}</p>
          )}
        </div>
      )}

      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <button
        onClick={() => onConfirm(amounts.map((cents, i) => ({ method: methods[i], amount: fromCents(cents) })))}
        disabled={busy}
        className={`${btn} mt-4 h-16 w-full bg-emerald-600 text-xl text-white`}
      >
        {busy ? 'Procesando…' : 'Confirmar cobro'}
      </button>
    </Modal>
  );
}

function ReceiptModal({ ticket, onClose }) {
  const sent = ticket.verifacti_status === 'sent';
  return (
    <Modal title={`Ticket ${ticket.invoice_number}`} onClose={onClose}>
      <p className="text-3xl font-bold">{formatEUR(toCents(ticket.total_amount))}</p>
      <p className="text-slate-600">
        {ticket.invoice_type === 'full' ? 'Factura completa' : 'Factura simplificada'}
        {ticket.table_number && ` · Mesa ${ticket.table_number}`}
      </p>

      <div className={`mt-4 rounded-xl p-4 ${sent ? 'bg-emerald-50' : 'bg-amber-50'}`}>
        {sent ? (
          <>
            <p className="font-semibold text-emerald-800">Registrado en VeriFactu</p>
            {ticket.qr_data && (
              <img
                src={ticket.qr_data.startsWith('data:') ? ticket.qr_data : `data:image/png;base64,${ticket.qr_data}`}
                alt="QR VeriFactu"
                className="mx-auto my-3 h-40 w-40"
              />
            )}
            {ticket.hash && <p className="break-all text-xs text-emerald-900">Huella: {ticket.hash}</p>}
          </>
        ) : (
          <>
            <p className="font-semibold text-amber-800">
              {ticket.verifacti_status === 'rejected' ? 'Rechazado por Verifacti' : 'Pendiente de envío a VeriFactu'}
            </p>
            <p className="text-sm text-amber-900">
              {ticket.verifacti_status === 'rejected'
                ? ticket.verifacti_error
                : 'El cobro está guardado. El registro se enviará automáticamente al recuperar la conexión.'}
            </p>
          </>
        )}
      </div>

      <button onClick={onClose} className={`${btn} mt-4 h-16 w-full bg-slate-900 text-xl text-white`}>
        Nueva venta
      </button>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------------

export default function POSDashboard() {
  const [catalog, setCatalog] = useState({ categories: [], products: [] });
  const [register, setRegister] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [activeCategory, setActiveCategory] = useState(null);
  const [cart, setCart] = useState({}); // { [productId]: quantity }
  const [table, setTable] = useState(null);
  const [fullInvoice, setFullInvoice] = useState(false);
  const [customer, setCustomer] = useState({ nif: '', name: '' });

  const [modal, setModal] = useState(null); // 'register' | 'tables' | 'checkout'
  const [busy, setBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [receipt, setReceipt] = useState(null);

  const refreshRegister = useCallback(async () => setRegister(await api.getCashRegister()), []);
  const refreshCatalog = useCallback(async () => {
    const data = await api.getCatalog();
    setCatalog(data);
    setActiveCategory((current) => current ?? data.categories[0]?.id ?? null);
  }, []);

  useEffect(() => {
    Promise.all([refreshCatalog(), refreshRegister()])
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [refreshCatalog, refreshRegister]);

  const productsById = useMemo(() => new Map(catalog.products.map((p) => [p.id, p])), [catalog.products]);
  const visibleProducts = useMemo(
    () => catalog.products.filter((p) => p.category_id === activeCategory),
    [catalog.products, activeCategory],
  );
  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, quantity]) => ({ product: productsById.get(Number(id)), quantity }))
        .filter((l) => l.product),
    [cart, productsById],
  );
  // Total orientativo: el importe definitivo lo calcula el servidor con los precios de la BD.
  const totalCents = lines.reduce((sum, l) => sum + toCents(l.product.price) * l.quantity, 0);

  const changeQty = (productId, delta) =>
    setCart((prev) => {
      const quantity = (prev[productId] || 0) + delta;
      const next = { ...prev };
      if (quantity <= 0) delete next[productId];
      else next[productId] = quantity;
      return next;
    });

  const resetSale = () => {
    setCart({});
    setTable(null);
    setFullInvoice(false);
    setCustomer({ nif: '', name: '' });
    setReceipt(null);
  };

  const customerOk = !fullInvoice || (customer.nif.trim() && customer.name.trim());
  const canCharge = register && lines.length > 0 && customerOk;

  const charge = async (payments) => {
    setBusy(true);
    setCheckoutError('');
    try {
      const ticket = await api.createTicket({
        items: lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
        table_number: table,
        invoice_type: fullInvoice ? 'full' : 'simplified',
        customer: fullInvoice ? customer : undefined,
        payments,
      });
      setModal(null);
      setReceipt(ticket);
      // Refresca stock y totales de caja sin bloquear el ticket.
      Promise.all([refreshCatalog(), refreshRegister()]).catch(() => {});
    } catch (err) {
      setCheckoutError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex h-full items-center justify-center text-xl">Cargando…</div>;
  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-xl text-red-700">{loadError}</p>
        <button onClick={() => window.location.reload()} className={`${btn} h-14 bg-slate-900 px-8 text-lg text-white`}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Cabecera */}
      <header className="flex items-center justify-between gap-3 bg-slate-900 px-4 py-3 text-white">
        <h1 className="text-xl font-bold">TPV Ateneu</h1>
        <button
          onClick={() => setModal('register')}
          className={`${btn} h-12 px-5 ${register ? 'bg-emerald-600' : 'bg-amber-500 text-slate-900'}`}
        >
          {register ? `Caja abierta · ${formatEUR(toCents(register.summary.total_sales))}` : 'Abrir caja'}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Catálogo */}
        <main className="flex min-h-0 flex-1 flex-col">
          <nav className="flex gap-2 overflow-x-auto bg-white p-3 shadow-sm">
            {catalog.categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(c.id)}
                className={`${btn} h-14 shrink-0 px-6 text-lg ${
                  activeCategory === c.id ? 'bg-slate-900 text-white' : 'bg-slate-100'
                }`}
              >
                {c.name}
              </button>
            ))}
          </nav>

          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto p-3 sm:grid-cols-3 xl:grid-cols-4">
            {visibleProducts.map((p) => {
              const inCart = cart[p.id] || 0;
              const soldOut = p.stock !== null && p.stock - inCart <= 0;
              return (
                <button
                  key={p.id}
                  onClick={() => changeQty(p.id, 1)}
                  disabled={soldOut}
                  className={`${btn} relative flex h-28 flex-col justify-between bg-white p-3 text-left shadow-sm`}
                >
                  <span className="text-lg leading-tight">{p.name}</span>
                  <span className="text-xl font-bold tabular-nums">{formatEUR(toCents(p.price))}</span>
                  {inCart > 0 && (
                    <span className="absolute right-2 top-2 flex h-8 min-w-8 items-center justify-center rounded-full bg-blue-600 px-2 text-white">
                      {inCart}
                    </span>
                  )}
                  {soldOut && <span className="absolute bottom-2 right-2 text-sm text-red-600">Agotado</span>}
                </button>
              );
            })}
            {visibleProducts.length === 0 && <p className="col-span-full p-6 text-center text-slate-500">Sin productos</p>}
          </div>
        </main>

        {/* Carrito */}
        <aside className="flex max-h-[55%] flex-col border-t border-slate-200 bg-white md:max-h-none md:w-96 md:border-l md:border-t-0">
          <div className="grid grid-cols-2 gap-2 p-3">
            <button onClick={() => setModal('tables')} className={`${btn} h-14 ${table ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}>
              {table ? `Mesa ${table}` : 'Sin mesa'}
            </button>
            <button
              onClick={() => setFullInvoice((v) => !v)}
              className={`${btn} h-14 ${fullInvoice ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}
            >
              {fullInvoice ? 'Factura completa' : 'Simplificada'}
            </button>
          </div>

          {fullInvoice && (
            <div className="grid grid-cols-5 gap-2 px-3 pb-3">
              <input
                value={customer.nif}
                onChange={(e) => setCustomer((c) => ({ ...c, nif: e.target.value }))}
                placeholder="NIF"
                className="col-span-2 h-12 rounded-xl border border-slate-300 px-3 uppercase"
              />
              <input
                value={customer.name}
                onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
                placeholder="Nombre o razón social"
                className="col-span-3 h-12 rounded-xl border border-slate-300 px-3"
              />
            </div>
          )}

          <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto px-3">
            {lines.length === 0 && <li className="py-8 text-center text-slate-400">Toca un producto para añadirlo</li>}
            {lines.map(({ product, quantity }) => (
              <li key={product.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{product.name}</p>
                  <p className="text-sm tabular-nums text-slate-500">{formatEUR(toCents(product.price) * quantity)}</p>
                </div>
                <button onClick={() => changeQty(product.id, -1)} className={`${btn} h-12 w-12 bg-slate-100 text-2xl`} aria-label="Quitar uno">
                  −
                </button>
                <span className="w-8 text-center text-lg font-semibold tabular-nums">{quantity}</span>
                <button
                  onClick={() => changeQty(product.id, 1)}
                  disabled={product.stock !== null && quantity >= product.stock}
                  className={`${btn} h-12 w-12 bg-slate-100 text-2xl`}
                  aria-label="Añadir uno"
                >
                  +
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-slate-200 p-3">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-lg text-slate-600">Total</span>
              <span className="text-3xl font-bold tabular-nums">{formatEUR(totalCents)}</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <button onClick={resetSale} disabled={!lines.length} className={`${btn} h-16 bg-slate-100 text-slate-700`}>
                Vaciar
              </button>
              <button
                onClick={() => {
                  setCheckoutError('');
                  setModal('checkout');
                }}
                disabled={!canCharge}
                className={`${btn} col-span-3 h-16 bg-emerald-600 text-2xl text-white`}
              >
                Cobrar
              </button>
            </div>
            {!register && <p className="mt-2 text-center text-sm text-amber-700">Abre la caja para poder cobrar</p>}
            {register && lines.length > 0 && !customerOk && (
              <p className="mt-2 text-center text-sm text-amber-700">Indica NIF y nombre para la factura completa</p>
            )}
          </div>
        </aside>
      </div>

      {/* Modales */}
      {modal === 'register' && (
        <CashRegisterModal register={register} onClose={() => setModal(null)} onChanged={refreshRegister} />
      )}
      {modal === 'tables' && (
        <Modal title="Mesa" onClose={() => setModal(null)}>
          <div className="grid grid-cols-4 gap-2">
            {TABLES.map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTable(t);
                  setModal(null);
                }}
                className={`${btn} h-16 text-xl ${table === t ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setTable(null);
              setModal(null);
            }}
            className={`${btn} mt-3 h-14 w-full bg-slate-100`}
          >
            Sin mesa (barra)
          </button>
        </Modal>
      )}
      {modal === 'checkout' && (
        <CheckoutModal
          totalCents={totalCents}
          busy={busy}
          error={checkoutError}
          onConfirm={charge}
          onClose={() => setModal(null)}
        />
      )}
      {receipt && <ReceiptModal ticket={receipt} onClose={resetSale} />}
    </div>
  );
}

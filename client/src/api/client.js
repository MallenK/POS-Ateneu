async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Sin conexión con el servidor del TPV');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

export const api = {
  getCatalog: () => request('/catalog'),
  getCashRegister: () => request('/cash-registers/current'),
  openCashRegister: (initial_amount) => request('/cash-registers/open', { method: 'POST', body: { initial_amount } }),
  closeCashRegister: (final_amount) => request('/cash-registers/close', { method: 'POST', body: { final_amount } }),
  createTicket: (ticket) => request('/tickets', { method: 'POST', body: ticket }),
  addPayments: (ticketId, payments) => request(`/tickets/${ticketId}/payments`, { method: 'POST', body: { payments } }),
};

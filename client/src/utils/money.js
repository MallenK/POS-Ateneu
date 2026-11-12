// Importes en céntimos enteros; la API los envía/recibe como string decimal ("12.50").
export const toCents = (value) => Math.round(Number(String(value).replace(',', '.')) * 100);
export const fromCents = (cents) => (cents / 100).toFixed(2);

const formatter = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export const formatEUR = (cents) => formatter.format(cents / 100);

/** Reparte `totalCents` en `parts` importes que suman exactamente el total. */
export function splitEvenly(totalCents, parts) {
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

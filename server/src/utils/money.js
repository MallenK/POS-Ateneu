// Todo el cálculo monetario se hace en céntimos enteros para evitar errores de coma flotante.

export const toCents = (value) => Math.round(Number(value) * 100);
export const fromCents = (cents) => (cents / 100).toFixed(2);

/**
 * Desglosa por tipo de IVA unas líneas con precio IVA incluido.
 * @param {{subtotalCents:number, taxRate:number}[]} lines
 * @returns {{taxRate:number, baseCents:number, taxCents:number, totalCents:number}[]}
 */
export function taxBreakdown(lines) {
  const byRate = new Map();
  for (const { subtotalCents, taxRate } of lines) {
    byRate.set(taxRate, (byRate.get(taxRate) || 0) + subtotalCents);
  }
  return [...byRate.entries()].map(([taxRate, totalCents]) => {
    const baseCents = Math.round(totalCents / (1 + taxRate / 100));
    return { taxRate, baseCents, taxCents: totalCents - baseCents, totalCents };
  });
}

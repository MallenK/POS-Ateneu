import { env } from '../config/env.js';
import { processQueue } from '../services/verifactiService.js';

/** Reintenta periódicamente los envíos pendientes a Verifacti. */
export function startVerifactiWorker() {
  let running = false;
  const tick = async () => {
    if (running) return; // evita solapes si una pasada tarda más que el intervalo
    running = true;
    try {
      const results = await processQueue();
      const sent = results.filter((r) => r.status === 'sent').length;
      if (sent) console.log(`[verifacti] ${sent} registro(s) enviados desde la cola`);
    } catch (err) {
      console.error('[verifacti] error en el worker:', err.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, env.verifacti.workerIntervalMs);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}

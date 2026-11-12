import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { startVerifactiWorker } from './jobs/verifactiWorker.js';
import cashRegisterRoutes from './routes/cashRegisters.js';
import catalogRoutes from './routes/catalog.js';
import ticketRoutes from './routes/tickets.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true, verifacti_mock: env.verifacti.mock }));
app.use('/api/catalog', catalogRoutes);
app.use('/api/cash-registers', cashRegisterRoutes);
app.use('/api/tickets', ticketRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message });
});

app.listen(env.port, () => {
  console.log(`API en http://localhost:${env.port} (Verifacti ${env.verifacti.mock ? 'MOCK' : 'REAL'})`);
  startVerifactiWorker();
});

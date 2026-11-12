import 'dotenv/config';

const bool = (v, def = false) => (v === undefined ? def : String(v).toLowerCase() === 'true');

export const env = {
  port: Number(process.env.PORT || 3001),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pos_ateneu',
  },
  series: {
    simplified: process.env.SERIES_SIMPLIFIED || 'T',
    full: process.env.SERIES_FULL || 'F',
  },
  verifacti: {
    mock: bool(process.env.VERIFACTI_MOCK, true),
    baseUrl: (process.env.VERIFACTI_BASE_URL || 'https://api.verifacti.com').replace(/\/$/, ''),
    apiKey: process.env.VERIFACTI_API_KEY || '',
    timeoutMs: Number(process.env.VERIFACTI_TIMEOUT_MS || 8000),
    workerIntervalMs: Number(process.env.VERIFACTI_WORKER_INTERVAL_MS || 30000),
  },
};

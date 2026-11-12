// Uso: node src/db/run-sql.js schema.sql
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const file = process.argv[2];
if (!file) throw new Error('Indica el fichero SQL (schema.sql | seed.sql)');

const dir = path.dirname(fileURLToPath(import.meta.url));
const sql = await fs.readFile(path.join(dir, file), 'utf8');

const { database, ...serverConn } = env.db;
const conn = await mysql.createConnection({ ...serverConn, multipleStatements: true });
await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await conn.query(`USE \`${database}\``);
await conn.query(sql);
await conn.end();
console.log(`OK: ${file} aplicado sobre ${database}`);

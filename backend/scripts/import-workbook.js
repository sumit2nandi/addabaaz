import mysql from 'mysql2/promise';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import { databaseConfig } from '../src/config.js';
import { ContentRepository } from '../src/repository.js';
import { readWorkbook } from '../../shared/workbook.js';

globalThis.ExcelJS = ExcelJS;
const args = process.argv.slice(2);
const file = args.find(arg => !arg.startsWith('--')) || new URL('../seed/website.xlsx', import.meta.url);
const tables = await readWorkbook(await fs.readFile(file));
const pool = mysql.createPool(databaseConfig());
try {
  const [[meta]] = await pool.query('SELECT revision FROM content_meta WHERE id = 1');
  if (!meta) throw new Error('Run npm run migrate first.');
  if (Number(meta.revision) > 0 && !args.includes('--replace')) throw new Error('Content already exists. Use --replace to intentionally replace it, after taking a database backup.');
  const revision = await new ContentRepository(pool).replace(tables, Number(meta.revision));
  console.log(`Imported ${Object.values(tables).reduce((n, rows) => n + rows.length, 0)} rows into MySQL; revision ${revision}.`);
} finally { await pool.end(); }

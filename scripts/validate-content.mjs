import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { readWorkbook } from '../shared/workbook.js';
globalThis.ExcelJS = ExcelJS;
const content = await readWorkbook(await fs.readFile('backend/seed/website.xlsx'));
console.log('Migration workbook is valid:', Object.fromEntries(Object.entries(content).map(([name, rows]) => [name, rows.length])));

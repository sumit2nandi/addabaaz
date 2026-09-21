import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { readWorkbook } from '../assets/js/workbook.js';
globalThis.ExcelJS = ExcelJS;
const filename = process.argv[2] || 'data/website.xlsx';
try {
  const tables = await readWorkbook(await fs.readFile(filename));
  console.log(`${filename} is valid.`);
  for (const [name, rows] of Object.entries(tables)) console.log(`  ${name}: ${rows.length} rows`);
} catch (error) {
  console.error(`Invalid workbook: ${error.message}`);
  process.exitCode = 1;
}

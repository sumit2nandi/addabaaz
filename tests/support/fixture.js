// Tests only: deliberately never imported by the production server.
import fs from 'node:fs/promises';
import ExcelJS from '../../backend/node_modules/exceljs/excel.js';
import { readWorkbook } from '../../shared/workbook.js';
import { validateContent, HttpError } from '../../backend/src/content.js';
globalThis.ExcelJS = ExcelJS;
export const original = await readWorkbook(await fs.readFile(new URL('../../backend/seed/website.xlsx', import.meta.url)));
export const token = 'test-only-ephemeral-admin-token-not-for-production';
export class MemoryRepository {
  constructor() { this.tables = structuredClone(original); this.revision = 1; this.messages = []; }
  async health() {}
  async read() { return { tables: structuredClone(this.tables), revision: this.revision, updatedAt: '2026-09-22T00:00:00.000Z' }; }
  async replace(tables, revision) {
    validateContent(tables);
    if (revision !== this.revision) throw new HttpError(409, 'Content changed.');
    this.tables = structuredClone(tables); return ++this.revision;
  }
  async addInquiry(value) { this.messages.push(value); return this.messages.length; }
  async inquiries() { return structuredClone(this.messages); }
}

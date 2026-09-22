import { SCHEMA } from '../../shared/workbook.js';
import { sections, sqlTable, validateContent, HttpError } from './content.js';
const quote = identifier => '`' + identifier + '`'; // Only fixed schema identifiers, never request input.

export class ContentRepository {
  constructor(pool) { this.pool = pool; }
  async health() { await this.pool.query('SELECT 1'); }
  async read() {
    const db = await this.pool.getConnection();
    try {
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await db.beginTransaction();
      const [[meta]] = await db.query('SELECT revision, updated_at FROM content_meta WHERE id = 1');
      if (!meta || Number(meta.revision) === 0) throw new HttpError(503, 'Content is not initialized. Run the backend workbook import.');
      const tables = {};
      for (const name of sections) {
        const [rows] = await db.query(`SELECT ${SCHEMA[name].columns.map(quote).join(',')} FROM ${sqlTable(name)} ORDER BY sort_order`);
        tables[name] = rows.map(row => ({ ...row }));
      }
      await db.commit();
      return { tables, revision: Number(meta.revision), updatedAt: new Date(meta.updated_at).toISOString() };
    } catch (error) { await db.rollback(); throw error; }
    finally { db.release(); }
  }
  async replace(tables, expectedRevision) {
    validateContent(tables);
    const db = await this.pool.getConnection();
    try {
      await db.beginTransaction();
      const [[meta]] = await db.query('SELECT revision FROM content_meta WHERE id = 1 FOR UPDATE');
      if (!meta) throw new HttpError(503, 'Run database migrations first.');
      if (Number(meta.revision) !== expectedRevision) throw new HttpError(409, 'Content changed. Reload before saving; your changes were not applied.');
      for (const name of [...sections].reverse()) await db.query(`DELETE FROM ${sqlTable(name)}`);
      for (const name of sections) {
        const columns = [...SCHEMA[name].columns, 'sort_order'];
        for (let start = 0; start < tables[name].length; start += 100) {
          const chunk = tables[name].slice(start, start + 100);
          const values = chunk.flatMap((row, index) => [...SCHEMA[name].columns.map(key => row[key]), start + index]);
          await db.execute(`INSERT INTO ${sqlTable(name)} (${columns.map(quote).join(',')}) VALUES ${chunk.map(() => '(' + columns.map(() => '?').join(',') + ')').join(',')}`, values);
        }
      }
      await db.query('UPDATE content_meta SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP(3) WHERE id = 1');
      await db.commit();
      return expectedRevision + 1;
    } catch (error) { await db.rollback(); throw error; }
    finally { db.release(); }
  }
  async addInquiry({ name, email, phone, message }) {
    const [result] = await this.pool.execute('INSERT INTO inquiries (name,email,phone,message) VALUES (?,?,?,?)', [name, email, phone, message]);
    return result.insertId;
  }
  async inquiries() {
    const [rows] = await this.pool.query('SELECT id,name,email,phone,message,created_at FROM inquiries ORDER BY id DESC LIMIT 100');
    return rows;
  }
}

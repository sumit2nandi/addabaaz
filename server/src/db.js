import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Tiny JSON-file datastore (atomic writes). Perfect for a single-node deployment, demos and tests.
 * To scale out, replace this module with Postgres/MySQL/Mongo/Firestore — app.js only uses the
 * collection-style API below (db.data.users, db.data.profiles, ..., db.save()).
 */
export class Db {
  constructor(file) {
    this.file = file;
    this.data = { meta: { secret: crypto.randomBytes(32).toString('hex') }, users: [], profiles: [], library: {}, subscriptions: {}, contacts: [] };
    if (file && fs.existsSync(file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    this.#queued = false;
    this.save();
  }
  #queued;
  save() {
    if (!this.file || this.#queued) return;
    this.#queued = true;
    setImmediate(() => {
      this.#queued = false;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    });
  }
  flush() { if (!this.file) return; fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data)); fs.renameSync(this.file + '.tmp', this.file); }
  lib(profileId) { return (this.data.library[profileId] ||= { list: [], progress: {}, reminders: [] }); }
}

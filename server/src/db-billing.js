// Data access for money-related documents: coupons, GST invoices / credit notes, and refunds.
// The business rules (tax split, wording, emails) live in billing.js and gst.js; this file only stores and locks rows correctly.
import crypto from 'node:crypto';
import { creditNoteSplit, financialYear, invoiceNumber } from './gst.js';

// Constants and tiny helpers.
const PENDING_HOLD_MIN = 30;          // an unpaid order keeps its coupon slot for this long
// Creates an Error with a machine-readable `code` (the API maps these codes to HTTP responses).
const fail = (code, message) => Object.assign(new Error(message), { code });
// JSON columns may come back as a string or an object depending on the driver; normalise.
const json = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

/** Coupons, invoices/credit notes and refunds. Mixed into createDb() (see db.js). */
export function billingDb({ q, tx, self, iso }) {
  // Row mappers (snake_case columns -> camelCase objects).
  const mapCoupon = (r) => r && ({
    code: r.code, description: r.description, kind: r.kind, value: r.value, planIds: r.plan_ids ? r.plan_ids.split(',') : null,
    maxRedemptions: r.max_redemptions, perUserLimit: r.per_user_limit, startsAt: iso(r.starts_at), expiresAt: iso(r.expires_at), active: !!r.active, createdAt: iso(r.created_at),
  });
  const mapInvoice = (r) => r && ({
    id: r.id, number: r.number, kind: r.kind, paymentId: r.payment_id, refundId: r.refund_id, parentId: r.parent_id, userId: r.user_id, fy: r.fy, issuedAt: iso(r.issued_at),
    taxable: r.taxable_paise, cgst: r.cgst_paise, sgst: r.sgst_paise, igst: r.igst_paise, total: r.total_paise, gstRate: Number(r.gst_rate), doc: json(r.doc),
  });
  const mapRefund = (r) => r && ({ id: r.id, paymentId: r.payment_id, providerRefundId: r.provider_refund_id, amountPaise: r.amount_paise, status: r.status, reason: r.reason, source: r.source, revokedAccess: !!r.revoked_access, createdAt: iso(r.created_at) });

  /** Counts redemptions that are paid, plus unpaid orders still inside the hold window. */
  // Used both for the overall coupon cap and each user's personal cap.
  async function usage(t, code, userId = null) {
    const rows = await t.query(
      `SELECT COUNT(*) AS n FROM payments WHERE coupon_code = ? AND (status = 'paid' OR (status = 'created' AND created_at > UTC_TIMESTAMP(3) - INTERVAL ${PENDING_HOLD_MIN} MINUTE))${userId ? ' AND user_id = ?' : ''}`,
      userId ? [code, userId] : [code]);
    return rows[0].n;
  }

  /** Next gapless number for (series, financial year); the counter row stays locked until the surrounding transaction ends.
   *  The row is normally created beforehand by ensureCounter() (outside the transaction) so no gap locks are taken here. */
  // The numbering is gapless because the counter is only incremented inside the issuing transaction.
  async function nextNo(t, series, fy) {
    let [row] = await t.query('SELECT last_no FROM invoice_counters WHERE series = ? AND fy = ? FOR UPDATE', [series, fy]);
    if (!row) { await t.query('INSERT IGNORE INTO invoice_counters (series, fy, last_no) VALUES (?,?,0)', [series, fy]); [row] = await t.query('SELECT last_no FROM invoice_counters WHERE series = ? AND fy = ? FOR UPDATE', [series, fy]); }
    await t.query('UPDATE invoice_counters SET last_no = last_no + 1 WHERE series = ? AND fy = ?', [series, fy]);
    return row.last_no + 1;
  }

  // ---- Tax invoices and credit notes ----
  const invoices = {
    /** Creates this financial year's counter row up front (call BEFORE opening the transaction that issues a document). */
    async ensureCounter(series, at = new Date()) { await q('INSERT IGNORE INTO invoice_counters (series, fy, last_no) VALUES (?,?,0)', [series, financialYear(at).code]); },
    /** Allocates a number and stores the document. Must run inside a transaction (`t`). */
    async issue(t, { kind, prefix, paymentId, refundId = null, parentId = null, userId, amounts, gstRate, doc, at = new Date() }) {
      const fy = financialYear(at);
      const series = kind === 'credit_note' ? 'CN' : 'INV';
      const number = invoiceNumber(prefix, fy.code, await nextNo(t, series, fy.code));
      const id = crypto.randomUUID();
      await t.query(
        `INSERT INTO invoices (id, number, kind, doc_key, payment_id, refund_id, parent_id, user_id, fy, issued_at, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, gst_rate, doc)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, number, kind, refundId || paymentId, paymentId, refundId, parentId, userId, fy.code, at, amounts.taxable, amounts.cgst, amounts.sgst, amounts.igst, amounts.total, gstRate, JSON.stringify(doc)]);
      return mapInvoice((await t.query('SELECT * FROM invoices WHERE id = ?', [id]))[0]);
    },
    async byId(id) { return mapInvoice((await q('SELECT * FROM invoices WHERE id = ?', [id]))[0]); },
    async forPayment(paymentId) { return (await q('SELECT * FROM invoices WHERE payment_id = ? ORDER BY issued_at, number', [paymentId])).map(mapInvoice); },
    /** Sales register for a date range (UTC), invoices and credit notes — feed for GSTR-1 / your accountant. */
    async register(from, to) {
      return (await q('SELECT * FROM invoices WHERE issued_at >= ? AND issued_at < ? ORDER BY issued_at, number', [from, to])).map(mapInvoice);
    },
  };

  // ---- Discount coupons ----
  const coupons = {
    async get(code) { return mapCoupon((await q('SELECT * FROM coupons WHERE code = ?', [code]))[0]); },
    async list() {
      const rows = await q(`SELECT c.*, (SELECT COUNT(*) FROM payments p WHERE p.coupon_code = c.code AND p.status = 'paid') AS redeemed FROM coupons c ORDER BY c.created_at DESC`);
      return rows.map((r) => ({ ...mapCoupon(r), redeemed: r.redeemed }));
    },
    async create(c) {
      await q('INSERT INTO coupons (code, description, kind, value, plan_ids, max_redemptions, per_user_limit, starts_at, expires_at, active) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [c.code, c.description ?? null, c.kind, c.value, c.planIds?.length ? c.planIds.join(',') : null, c.maxRedemptions ?? null, c.perUserLimit ?? 1, c.startsAt ?? null, c.expiresAt ?? null, c.active === false ? 0 : 1]);
      return this.get(c.code);
    },
    /** Only these fields can change after creation: the discount itself is immutable so old invoices stay explainable. */
    async update(code, p) {
      const set = [], v = [];
      const add = (col, val) => { set.push(`${col} = ?`); v.push(val); };
      if (p.active !== undefined) add('active', p.active ? 1 : 0);
      if (p.expiresAt !== undefined) add('expires_at', p.expiresAt);
      if (p.startsAt !== undefined) add('starts_at', p.startsAt);
      if (p.maxRedemptions !== undefined) add('max_redemptions', p.maxRedemptions);
      if (p.perUserLimit !== undefined) add('per_user_limit', p.perUserLimit);
      if (p.description !== undefined) add('description', p.description);
      if (set.length) await q(`UPDATE coupons SET ${set.join(', ')} WHERE code = ?`, [...v, code]);
      return this.get(code);
    },
    /** Deletes a coupon that has never been used (anything used is kept for the records — deactivate it instead). Returns false if it was used. */
    async remove(code) {
      if ((await q('SELECT COUNT(*) AS n FROM payments WHERE coupon_code = ?', [code]))[0].n) return false;
      await q('DELETE FROM coupons WHERE code = ?', [code]); return true;
    },
    usage: (code, userId) => usage({ query: q }, code, userId),
    /** Re-checks the limits under a row lock, then runs `insert` — two buyers can't both take the last redemption. */
    // The lock is what makes the limits safe under concurrent purchases.
    async reserve(coupon, userId, insert) {
      return tx(async (t) => {
        await t.query('SELECT code FROM coupons WHERE code = ? FOR UPDATE', [coupon.code]);
        if (coupon.maxRedemptions != null && (await usage(t, coupon.code)) >= coupon.maxRedemptions) throw fail('coupon_exhausted', 'This coupon has been fully redeemed.');
        if ((await usage(t, coupon.code, userId)) >= coupon.perUserLimit) throw fail('coupon_used', 'You have already used this coupon.');
        return insert(t);
      });
    },
  };

  // ---- Refunds: one row per refund event reported by an admin, the API or a webhook ----
  const refunds = {
    async forPayment(paymentId) { return (await q('SELECT * FROM refunds WHERE payment_id = ? ORDER BY created_at', [paymentId])).map(mapRefund); },
    /**
     * Records a refund event idempotently (admin action, API response and webhooks can all report the same refund):
     *  - never lets refunds exceed the amount paid,
     *  - a full refund (or `revokeAccess`) shortens the buyer's access by the days that payment bought,
     *  - a failed refund gives that time back,
     *  - once processed, exactly one credit note is issued (via `creditNote()`, which builds the document).
     */
    async record({ paymentId, providerRefundId, amountPaise, status, reason = null, source, revokeAccess = false, days = 0, creditNote = null }) {
      if (creditNote) await invoices.ensureCounter('CN');
      return tx(async (t) => {
        const [p] = await t.query('SELECT * FROM payments WHERE id = ? FOR UPDATE', [paymentId]);
        if (!p) throw fail('not_found', 'Unknown payment.');
        const rows = await t.query('SELECT * FROM refunds WHERE payment_id = ? FOR UPDATE', [paymentId]);
        let r = rows.find((x) => x.provider_refund_id === providerRefundId), created = false;
        if (!r) {
          const active = rows.filter((x) => x.status !== 'failed').reduce((n, x) => n + x.amount_paise, 0);
          if (status !== 'failed' && active + amountPaise > p.amount_paise) throw fail('refund_exceeds_payment', 'Refunds would exceed the amount paid.');
          const id = crypto.randomUUID();
          await t.query('INSERT INTO refunds (id, payment_id, provider_refund_id, amount_paise, status, reason, source) VALUES (?,?,?,?,?,?,?)', [id, paymentId, providerRefundId, amountPaise, status, reason, source]);
          r = (await t.query('SELECT * FROM refunds WHERE id = ?', [id]))[0]; rows.push(r); created = true;
        } else {
          const from = r.status;
          if ((from === 'pending' && status !== 'pending') || (from === 'failed' && status === 'processed')) { await t.query('UPDATE refunds SET status = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [status, r.id]); r.status = status; }
          if (!r.reason && reason) { await t.query('UPDATE refunds SET reason = ? WHERE id = ?', [reason, r.id]); r.reason = reason; }
        }
        // access
        // Total of all refunds that have not failed, used to decide whether the whole payment is now refunded.
        const live = rows.filter((x) => x.status !== 'failed').reduce((n, x) => n + x.amount_paise, 0);
        let revoked = !!r.revoked_access;
        if (r.status !== 'failed' && !revoked && (revokeAccess || live >= p.amount_paise) && p.user_id && days > 0) {
          await t.query('UPDATE subscriptions SET expires_at = GREATEST(UTC_TIMESTAMP(3), expires_at - INTERVAL ? SECOND), expiry_reminder_for = NULL WHERE user_id = ?', [days * 86400, p.user_id]);
          revoked = true;
        } else if (r.status === 'failed' && revoked) {
          if (p.user_id) await self.subscriptions.extend(p.user_id, { planId: p.plan_id, days, provider: p.provider }, t);
          revoked = false;
        }
        if (revoked !== !!r.revoked_access) { await t.query('UPDATE refunds SET revoked_access = ? WHERE id = ?', [revoked ? 1 : 0, r.id]); r.revoked_access = revoked ? 1 : 0; }
        // credit note + running total
        // Only a refund that reached `processed` produces a credit note, and only once.
        let note = null, becameProcessed = false;
        if (r.status === 'processed') {
          const existing = (await t.query("SELECT * FROM invoices WHERE refund_id = ? AND kind = 'credit_note'", [r.id]))[0];
          if (!existing) {
            becameProcessed = true;
            const inv = mapInvoice((await t.query("SELECT * FROM invoices WHERE payment_id = ? AND kind = 'invoice'", [paymentId]))[0]);
            if (inv && creditNote) {
              const prior = (await t.query("SELECT * FROM invoices WHERE payment_id = ? AND kind = 'credit_note'", [paymentId])).map(mapInvoice);
              const split = creditNoteSplit(inv, prior, r.amount_paise);
              const built = creditNote({ payment: p, invoice: inv, split, refund: mapRefund(r) });
              if (built) note = await invoices.issue(t, { kind: 'credit_note', prefix: built.prefix, paymentId, refundId: r.id, parentId: inv.id, userId: p.user_id, amounts: split, gstRate: inv.gstRate, doc: built.doc });
            }
          } else note = mapInvoice(existing);
          const done = rows.filter((x) => x.status === 'processed').reduce((n, x) => n + x.amount_paise, 0);
          await t.query('UPDATE payments SET refunded_paise = ? WHERE id = ?', [done, paymentId]);
        }
        return { refund: mapRefund(r), created, creditNote: note, becameProcessed, revoked };
      });
    },
  };
  // Merged into the main `db` object by db.js.
  return { coupons, invoices, refunds };
}

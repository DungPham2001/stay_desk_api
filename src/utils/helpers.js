'use strict';
const { E } = require('./errors');

/** Chỉ giữ chữ số; +84 / 84 ở đầu quy về 0 */
function normalizePhone(p) {
  if (p === undefined || p === null) return p;
  let d = String(p).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('84') && d.length >= 11) d = '0' + d.slice(2);
  return d;
}

/** Bỏ dấu tiếng Việt, chữ thường, gộp khoảng trắng — dùng cho tìm kiếm không dấu */
function fold(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '')); }

function isStrongPassword(p) {
  return typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** If-Match: <updatedAt> chống ghi đè */
function checkIfMatch(req, doc) {
  const h = req.get('If-Match');
  if (!h || !doc || !doc.updatedAt) return;
  const want = new Date(h.replace(/^W\//, '').replace(/"/g, ''));
  if (Number.isNaN(want.getTime())) return;
  if (Math.abs(want.getTime() - new Date(doc.updatedAt).getTime()) >= 1000) {
    throw E('conflict', { updatedAt: doc.updatedAt });
  }
}

/* ---------- Cursor pagination ---------- */
function encodeCursor(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }
function decodeCursor(s) {
  try { return JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8')); } catch { return null; }
}

/**
 * Phân trang theo con trỏ trên (field desc/asc, _id).
 * @returns {Promise<{items:any[], nextCursor:string|null}>}
 */
async function paginate(Model, filter, { limit = 50, cursor, field = 'createdAt', dir = -1, select, transform } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const q = { ...filter };
  const c = cursor ? decodeCursor(cursor) : null;
  if (c && c.v !== undefined) {
    const v = c.d ? new Date(c.v) : c.v;
    const op = dir === -1 ? '$lt' : '$gt';
    const cond = { $or: [{ [field]: { [op]: v } }, { [field]: v, _id: { [op]: c.id } }] };
    if (q.$and) q.$and = [...q.$and, cond]; else q.$and = [cond];
  }
  let query = Model.find(q).sort({ [field]: dir, _id: dir }).limit(lim + 1).lean();
  if (select) query = query.select(select);
  const rows = await query;
  const hasMore = rows.length > lim;
  const items = hasMore ? rows.slice(0, lim) : rows;
  let nextCursor = null;
  if (hasMore) {
    const last = items[items.length - 1];
    const v = last[field];
    nextCursor = encodeCursor({ v: v instanceof Date ? v.toISOString() : v, d: v instanceof Date, id: last._id });
  }
  return { items: transform ? await transform(items) : items, nextCursor };
}

const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);

module.exports = {
  normalizePhone, fold, escapeRegex, isEmail, isStrongPassword, pick, checkIfMatch,
  paginate, encodeCursor, decodeCursor, sum,
};

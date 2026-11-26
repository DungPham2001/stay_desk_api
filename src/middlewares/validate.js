'use strict';
const { z } = require('zod');
const { E } = require('../utils/errors');

function toFields(err) {
  const fields = {};
  for (const i of err.issues) {
    const k = i.path.join('.') || '_';
    if (!fields[k]) fields[k] = i.message;
  }
  return fields;
}

/** Parse body bằng zod; kết quả gán vào req.body. Lỗi → 400 validation_failed */
const body = (schema) => (req, _res, next) => {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) return next(E('validation_failed', { fields: toFields(r.error) }));
  req.body = r.data;
  return next();
};

/** Parse query; kết quả gán vào req.q (Express 5: req.query chỉ đọc) */
const query = (schema) => (req, _res, next) => {
  const r = schema.safeParse(req.query ?? {});
  if (!r.success) return next(E('validation_failed', { fields: toFields(r.error) }));
  req.q = r.data;
  return next();
};

/* ---------- Kiểu dùng chung ---------- */
const money = z.coerce.number().int('Phải là số nguyên đồng').min(0);
const int = z.coerce.number().int();
const str = (max = 500) => z.string().trim().max(max);
const id = z.string().min(1).max(64);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng YYYY-MM-DD');
const datetime = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), 'Thời gian không hợp lệ');
const minuteOfDay = z.coerce.number().int().min(0).max(1439);

module.exports = { body, query, z, money, int, str, id, dateStr, datetime, minuteOfDay, toFields };

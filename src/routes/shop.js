'use strict';
const { Router } = require('express');
const { BankCatalog, ClosedDate } = require('../models');
const { E, notFound } = require('../utils/errors');
const { body, z, str, int, money, dateStr, minuteOfDay } = require('../middlewares/validate');
const settings = require('../services/settings');
const { crud } = require('./_crud');
const { IANAZone } = require('luxon');

const r = Router();

/* ------------------------------ /shop (131) ------------------------------ */
const shopSchema = z.object({
  name: str(200).min(1),
  desc: str(2000).optional().default(''),
  phone: str(30).optional().default(''),
  address: str(500).optional().default(''),
  rep: str(200).optional().default(''),
  bizReg: str(200).optional().default(''),
});
r.get('/shop', async (_req, res) => res.json(await settings.get('shop')));
r.put('/shop', body(shopSchema), async (req, res) => res.json(await settings.set('shop', req.body)));

/* -------------------------- /shop/rules (88, 89, 132) -------------------------- */
const rulesSchema = z.object({
  minHours: int.min(1).max(24),
  graceMin: int.min(0).max(180),
  roundHalf: z.boolean(),
  capHours: int.min(1).max(48),
  roundTo: int.min(1).max(1000000),
  cleanBuffer: int.min(0).max(1440),
  holdMin: int.min(0).max(10080),
  overdueWarn: int.min(0).max(1440),
  depositDefault: money,
  retainDays: int.min(0).max(3650),
  checkInMin: minuteOfDay,
  checkOutMin: minuteOfDay,
  timezone: z.string().refine((tz) => IANAZone.isValidZone(tz), 'Múi giờ không hợp lệ'),
  dayCloseMin: minuteOfDay,
  reopenHours: int.min(0).max(720),
  blockCloseOnUnpaid: z.boolean(),
  dirtyWarnMin: int.min(0).max(1440),
  checkoutLeadMin: int.min(0).max(1440),
  bookingLeadMin: int.min(0).max(1440),
  bigDiscountPct: int.min(0).max(100),
  bigDiscountAmt: money,
}).partial();

r.get('/shop/rules', async (_req, res) => res.json(await settings.getRules()));
r.put('/shop/rules', body(rulesSchema), async (req, res) => {
  const cur = await settings.getRules();
  res.json(await settings.set('rules', { ...cur, ...req.body }));
});

/* ---------------------------- /shop/policy (133) ---------------------------- */
r.get('/shop/policy', async (_req, res) => res.json(await settings.get('policy')));
r.put('/shop/policy', body(z.object({ text: str(10000) })), async (req, res) => res.json(await settings.set('policy', { text: req.body.text })));

/* -------------------------- /shop/closed-dates (134) -------------------------- */
crud(r, '/shop/closed-dates', ClosedDate, {
  schema: z.object({ date: dateStr, reason: str(200).optional().default('') }),
  sort: { date: 1 },
  only: ['list', 'create', 'update', 'delete'],
});

/* ------------------------------- Ngân hàng (135) ------------------------------- */
r.get('/banks', async (_req, res) => {
  const rows = await BankCatalog.find().sort({ name: 1 }).lean();
  res.json({ items: rows.map((b) => ({ code: b._id, bin: b.bin, name: b.name, shortName: b.shortName || b._id })) });
});

r.get('/bank-info', async (_req, res) => {
  const v = await settings.get('bankInfo');
  if (!v) throw notFound('bankInfo');
  res.json(v);
});

r.put('/bank-info', body(z.object({
  bank: str(20).min(1),
  account: z.string().trim().regex(/^[0-9A-Za-z]{4,30}$/, 'Số tài khoản không hợp lệ'),
  holder: str(100).min(1),
})), async (req, res) => {
  const bank = await BankCatalog.findById(req.body.bank).lean();
  if (!bank) throw E('validation_failed', { fields: { bank: 'Ngân hàng không có trong danh mục' } });
  const holder = req.body.holder.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase();
  res.json(await settings.set('bankInfo', { bank: bank._id, bin: bank.bin, bankName: bank.name, account: req.body.account, holder }));
});

module.exports = r;

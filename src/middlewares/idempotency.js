'use strict';
const { Idempotency } = require('../models');
const { E } = require('../utils/errors');

/**
 * Idempotency-Key: cùng key trong 24h → trả lại đúng phản hồi lần đầu, không thực hiện lại.
 * Key phạm vi theo tài khoản. Lỗi 4xx/5xx không được lưu để app có thể thử lại.
 */
function idempotent(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (!key) return next();
  if (!/^[A-Za-z0-9-]{8,100}$/.test(key)) return next(E('validation_failed', { fields: { 'Idempotency-Key': 'invalid' } }));
  const id = `${req.account?._id || 'anon'}:${key}`;
  const path = req.originalUrl.split('?')[0];

  (async () => {
    try {
      await Idempotency.create({ _id: id, method: req.method, path, done: false });
    } catch (e) {
      if (e.code !== 11000) throw e;
      const rec = await Idempotency.findById(id).lean();
      if (rec && rec.done) {
        if (rec.path !== path) throw E('conflict', undefined, 'Idempotency-Key đã dùng cho yêu cầu khác');
        res.set('Idempotent-Replay', 'true');
        return res.status(rec.status).type('application/json').send(rec.body);
      }
      throw E('conflict', undefined, 'Yêu cầu cùng Idempotency-Key đang được xử lý');
    }
    const origSend = res.send.bind(res);
    res.send = (body) => {
      const ok = res.statusCode < 400;
      const p = ok
        ? Idempotency.updateOne({ _id: id }, { status: res.statusCode, body: typeof body === 'string' ? body : JSON.stringify(body ?? null), done: true })
        : Idempotency.deleteOne({ _id: id });
      p.catch(() => {});
      return origSend(body);
    };
    return next();
  })().catch(next);
}

module.exports = { idempotent };

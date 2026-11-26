'use strict';
const { Counter } = require('../models');

async function nextSeq(name, session) {
  const doc = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true, session });
  return doc.seq;
}

/** S0042, B0001 ... */
async function nextCode(name, prefix, width = 4, session) {
  const n = await nextSeq(name, session);
  return prefix + String(n).padStart(width, '0');
}

module.exports = { nextSeq, nextCode };

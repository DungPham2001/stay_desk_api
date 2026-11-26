'use strict';
const { StockMove } = require('../models');

/** Tồn kho = Σ qty của sổ kho. Trả Map targetId → stock */
async function stockMap(target, ids) {
  const match = { target };
  if (ids) match.targetId = { $in: ids };
  const rows = await StockMove.aggregate([{ $match: match }, { $group: { _id: '$targetId', stock: { $sum: '$qty' } } }]);
  return new Map(rows.map((r) => [r._id, r.stock]));
}

async function stockOf(target, targetId) {
  const m = await stockMap(target, [targetId]);
  return m.get(targetId) || 0;
}

module.exports = { stockMap, stockOf };

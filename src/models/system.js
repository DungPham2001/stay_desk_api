'use strict';
const { makeSchema, model, Schema } = require('./base');
const mongoose = require('mongoose');
const E = require('./enums');

/** Cấu hình dạng key-value: shop, rules, policy, bankInfo */
const Setting = model('Setting', new Schema({
  _id: String,
  value: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, versionKey: false, minimize: false }));

const Counter = model('Counter', new Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false }));

const BankCatalog = model('BankCatalog', new Schema({
  _id: String, // code
  bin: { type: String, required: true },
  name: { type: String, required: true },
  shortName: String,
}, { versionKey: false }), 'bankcatalog');

const AdminAction = model('AdminAction', (() => {
  const s = makeSchema({
    action: { type: String, required: true },
    targetType: String,
    targetId: String,
    note: { type: String, default: '' },
    by: String,
    byId: String,
    at: { type: Date, default: Date.now },
  });
  s.index({ at: -1 });
  s.index({ action: 1, at: -1 });
  return s;
})(), 'adminactions');

const Idempotency = model('Idempotency', (() => {
  const s = new Schema({
    _id: String, // accountId:key
    method: String,
    path: String,
    status: Number,
    body: String,
    done: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  }, { versionKey: false });
  s.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 3600 });
  return s;
})(), 'idempotency');

/** Khóa ứng dụng (mutex) – an toàn cả khi Mongo standalone không có transaction */
const Lock = model('Lock', (() => {
  const s = new Schema({ _id: String, owner: String, expiresAt: Date }, { versionKey: false });
  s.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  return s;
})(), 'locks');

const Todo = model('Todo', makeSchema({
  title: { type: String, required: true },
  due: { type: Date, default: null },
  repeat: { type: String, enum: E.RepeatRule, default: 'none' },
  done: { type: Boolean, default: false },
  refType: { type: String, default: null },
  refId: { type: String, default: null },
}));

const Note = model('Note', makeSchema({ text: { type: String, required: true } }));

const ChecklistItem = model('ChecklistItem', makeSchema({
  kind: { type: String, enum: E.ChecklistKind, required: true },
  title: { type: String, required: true },
  sort: { type: Number, default: 0 },
}), 'checklistitems');

const ChecklistRun = model('ChecklistRun', (() => {
  const s = makeSchema({ date: { type: String, required: true }, doneItemIds: { type: [String], default: [] }, by: String });
  s.index({ date: 1 }, { unique: true });
  return s;
})(), 'checklistruns');

const ReminderDone = model('ReminderDone', (() => {
  const s = new Schema({ _id: String, at: { type: Date, default: Date.now }, by: String }, { versionKey: false });
  s.index({ at: 1 }, { expireAfterSeconds: 30 * 86400 });
  return s;
})(), 'reminderdone');

module.exports = {
  Setting, Counter, BankCatalog, AdminAction, Idempotency, Lock, Todo, Note, ChecklistItem, ChecklistRun, ReminderDone, mongoose,
};

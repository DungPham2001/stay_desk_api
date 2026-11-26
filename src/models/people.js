'use strict';
const { makeSchema, model } = require('./base');
const E = require('./enums');

const Staff = model('Staff', makeSchema({
  name: { type: String, required: true },
  phone: { type: String, default: '' },
  role: { type: String, enum: E.StaffRole, required: true },
  joinedOn: { type: String, default: null },
  wage: { type: Number, default: 0 },
  status: { type: String, enum: E.StaffStatus, default: 'on' },
  note: { type: String, default: '' },
}), 'staff');

const StaffSchedule = model('StaffSchedule', makeSchema({
  staffId: { type: String, required: true },
  date: { type: String, required: true },
  startMin: { type: Number, default: 0 },
  endMin: { type: Number, default: 0 },
  kind: { type: String, enum: ['work', 'off'], default: 'work' },
  note: { type: String, default: '' },
}), 'staffschedules');

module.exports = { Staff, StaffSchedule };

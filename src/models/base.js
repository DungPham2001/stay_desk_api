'use strict';
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const { Schema } = mongoose;

/** Schema chuẩn: _id UUID v4 dạng chuỗi, createdAt/updatedAt */
function makeSchema(def, opts = {}) {
  return new Schema(
    { _id: { type: String, default: () => randomUUID() }, ...def },
    { timestamps: true, versionKey: false, minimize: false, ...opts },
  );
}

const sub = (def, opts = {}) => new Schema(def, { _id: false, minimize: false, ...opts });

function model(name, schema, collection) {
  return mongoose.models[name] || mongoose.model(name, schema, collection);
}

module.exports = { makeSchema, sub, model, Schema, randomUUID };

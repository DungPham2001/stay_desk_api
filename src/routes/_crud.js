'use strict';
const { body } = require('../middlewares/validate');
const { notFound } = require('../utils/errors');
const { checkIfMatch } = require('../utils/helpers');
const { audit } = require('../services/audit');

/**
 * Sinh nhanh CRUD chuẩn: GET list, GET /:id, POST, PATCH /:id, DELETE /:id
 * opts: { schema (zod object), sort, filter(req)→query, list(items, req), map(doc), beforeDelete(doc), beforeSave(data, req, doc),
 *         only: ['list','get','create','update','delete'], auditDelete: true }
 */
function crud(router, path, Model, opts = {}) {
  const only = new Set(opts.only || ['list', 'get', 'create', 'update', 'delete']);
  const sort = opts.sort || { createdAt: -1 };
  const map = opts.map || ((x) => x);

  if (only.has('list')) {
    router.get(path, async (req, res) => {
      const q = opts.filter ? await opts.filter(req) : {};
      let items = await Model.find(q).sort(sort).limit(opts.limit || 1000).lean();
      if (opts.list) items = await opts.list(items, req);
      res.json({ items: items.map(map) });
    });
  }
  if (only.has('get')) {
    router.get(`${path}/:id`, async (req, res) => {
      const doc = await Model.findById(req.params.id).lean();
      if (!doc) throw notFound();
      const [one] = opts.list ? await opts.list([doc], req) : [doc];
      res.json(map(one));
    });
  }
  if (only.has('create')) {
    router.post(path, body(opts.schema), async (req, res) => {
      const data = opts.beforeSave ? await opts.beforeSave({ ...req.body }, req, null) : req.body;
      const doc = await Model.create(data);
      res.status(201).json(map(doc.toObject()));
    });
  }
  if (only.has('update')) {
    router.patch(`${path}/:id`, body(opts.schema.partial()), async (req, res) => {
      const doc = await Model.findById(req.params.id);
      if (!doc) throw notFound();
      checkIfMatch(req, doc);
      const data = opts.beforeSave ? await opts.beforeSave({ ...req.body }, req, doc) : req.body;
      doc.set(data);
      await doc.save();
      res.json(map(doc.toObject()));
    });
  }
  if (only.has('delete')) {
    router.delete(`${path}/:id`, async (req, res) => {
      const doc = await Model.findById(req.params.id).lean();
      if (!doc) throw notFound();
      if (opts.beforeDelete) await opts.beforeDelete(doc, req);
      await Model.deleteOne({ _id: doc._id });
      if (opts.auditDelete) await audit(req, 'delete', Model.modelName, doc._id, doc.name || doc.title || doc.code || '');
      res.status(204).end();
    });
  }
}

module.exports = { crud };

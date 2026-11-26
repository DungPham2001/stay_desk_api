'use strict';
module.exports = {
  ...require('./auth'),
  ...require('./property'),
  ...require('./stay'),
  ...require('./booking'),
  ...require('./ops'),
  ...require('./inventory'),
  ...require('./crm'),
  ...require('./people'),
  ...require('./finance'),
  ...require('./system'),
  Enums: require('./enums'),
};

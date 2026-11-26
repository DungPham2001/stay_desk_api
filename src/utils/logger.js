'use strict';
/* Logger tối giản. KHÔNG ghi body request/response hay dữ liệu cá nhân của khách. */
const ts = () => new Date().toISOString();
module.exports = {
  info: (...a) => console.log(ts(), 'INFO', ...a),
  warn: (...a) => console.warn(ts(), 'WARN', ...a),
  error: (...a) => console.error(ts(), 'ERROR', ...a),
};

const auth = require('../../lib/auth');
const { jsonWithCookie } = require('../../lib/http');

exports.handler = async () => {
  return jsonWithCookie(200, { ok: true }, auth.buildClearCookie());
};

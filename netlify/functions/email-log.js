const { db } = require('../../lib/db');
const auth = require('../../lib/auth');
const { json } = require('../../lib/http');

exports.handler = async (event) => {
  const authResult = auth.requireAuth(event);
  if (authResult.error) return authResult.error;

  const sql = db();
  const qp = event.queryStringParameters || {};
  let rows;
  if (qp.clientId) {
    rows = await sql.sql`SELECT * FROM email_log WHERE client_id = ${Number(qp.clientId)} ORDER BY criado_em DESC LIMIT 200`;
  } else if (qp.licenseId) {
    rows = await sql.sql`SELECT * FROM email_log WHERE license_id = ${Number(qp.licenseId)} ORDER BY criado_em DESC LIMIT 200`;
  } else {
    rows = await sql.sql`SELECT * FROM email_log ORDER BY criado_em DESC LIMIT 200`;
  }
  return json(200, { emails: rows });
};

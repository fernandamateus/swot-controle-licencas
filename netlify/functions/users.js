const { db } = require('../../lib/db');
const auth = require('../../lib/auth');
const { json } = require('../../lib/http');

exports.handler = async (event) => {
  const result = auth.requireAdmin(event);
  if (result.error) return result.error;

  const sql = db();
  const rows = await sql.sql`SELECT id, name, email, role, must_change_password, created_at FROM users ORDER BY id`;
  return json(200, { users: rows });
};

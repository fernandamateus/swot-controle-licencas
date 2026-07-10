const { db } = require('../../lib/db');
const auth = require('../../lib/auth');
const { json } = require('../../lib/http');

exports.handler = async (event) => {
  const result = auth.requireAuth(event);
  if (result.error) return result.error;

  const sql = db();
  const rows = await sql.sql`SELECT id, name, email, role, must_change_password FROM users WHERE id = ${result.session.sub}`;
  const user = rows[0];
  if (!user) return json(401, { error: 'Usuario nao encontrado.' });

  return json(200, {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.must_change_password },
  });
};

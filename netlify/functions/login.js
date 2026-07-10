const { db } = require('../../lib/db');
const auth = require('../../lib/auth');
const token = require('../../lib/token');
const { json, jsonWithCookie, parseBody } = require('../../lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metodo nao permitido' });

  const { email, password } = parseBody(event);
  if (!email || !password) return json(400, { error: 'Informe e-mail e senha.' });

  const sql = db();
  const rows = await sql.sql`SELECT * FROM users WHERE email = ${String(email).toLowerCase().trim()}`;
  const user = rows[0];
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    return json(401, { error: 'E-mail ou senha incorretos.' });
  }

  const sessionToken = token.sign({ sub: user.id, role: user.role, name: user.name, email: user.email });
  const cookie = auth.buildSessionCookie(sessionToken);

  return jsonWithCookie(200, {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.must_change_password },
  }, cookie);
};

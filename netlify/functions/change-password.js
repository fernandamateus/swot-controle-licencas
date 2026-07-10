const { db } = require('../../lib/db');
const auth = require('../../lib/auth');
const { json, parseBody } = require('../../lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metodo nao permitido' });
  const result = auth.requireAuth(event);
  if (result.error) return result.error;

  const { currentPassword, newPassword } = parseBody(event);
  if (!newPassword || newPassword.length < 8) {
    return json(400, { error: 'A nova senha deve ter ao menos 8 caracteres.' });
  }

  const sql = db();
  const rows = await sql.sql`SELECT * FROM users WHERE id = ${result.session.sub}`;
  const user = rows[0];
  if (!user) return json(401, { error: 'Usuario nao encontrado.' });

  if (!user.must_change_password) {
    if (!currentPassword || !auth.verifyPassword(currentPassword, user.password_hash)) {
      return json(400, { error: 'Senha atual incorreta.' });
    }
  }

  const newHash = auth.hashPassword(newPassword);
  await sql.sql`UPDATE users SET password_hash = ${newHash}, must_change_password = FALSE WHERE id = ${user.id}`;

  return json(200, { ok: true });
};

// Admin master pode redefinir a senha de qualquer usuario (ex.: Thaynara esqueceu a senha).
const { db } = require('../../lib/db');
const auth = require('../../lib/auth');
const { json, parseBody } = require('../../lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metodo nao permitido' });
  const result = auth.requireAdmin(event);
  if (result.error) return result.error;

  const { userId, newPassword } = parseBody(event);
  if (!userId || !newPassword || newPassword.length < 8) {
    return json(400, { error: 'Informe o usuario e uma nova senha com ao menos 8 caracteres.' });
  }

  const sql = db();
  const newHash = auth.hashPassword(newPassword);
  await sql.sql`UPDATE users SET password_hash = ${newHash}, must_change_password = TRUE WHERE id = ${userId}`;

  return json(200, { ok: true });
};

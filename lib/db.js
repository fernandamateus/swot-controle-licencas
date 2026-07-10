// Conexao com PostgreSQL usando o pacote 'postgres' (tagged template literals)
// Uso: const sql = db(); const rows = await sql`SELECT * FROM users WHERE id = ${id}`;
const postgres = require('postgres');

let _sql = null;
function db() {
  if (!_sql) {
    _sql = postgres(process.env.DATABASE_URL, {
      ssl: { rejectUnauthorized: false },
      max: 10,
      idle_timeout: 30,
    });
  }
  return _sql;
}

module.exports = { db };

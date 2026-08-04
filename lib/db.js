// Conexao com PostgreSQL.
//
// Usa sempre o pacote 'postgres' apontando para DATABASE_URL. Isso funciona tanto
// no Railway/Express (server.js) quanto nas Netlify Functions: no caso da Netlify,
// DATABASE_URL foi configurado manualmente com a connection string "Read and write"
// do banco (Netlify DB / Neon), copiada do dashboard em Database > production > Connect.
//
// Obs.: o driver oficial @netlify/database (getDatabase()) deveria configurar isso
// sozinho em tempo de execucao, mas na pratica lancou "The environment has not been
// configured to use Netlify Database" mesmo rodando dentro de uma Netlify Function
// (ver https://ntl.fyi/database-environment). Por isso optamos pela conexao direta,
// que e mais simples e previsível.
//
// O objeto retornado pode ser usado tanto como `sql\`...\`` (tag direta) quanto como
// `sql.sql\`...\`` (padrao usado nas netlify functions), pois o proprio objeto expoe
// a propriedade `.sql` apontando para si mesmo.
let _sql = null;

function db() {
  if (_sql) return _sql;

  const postgres = require('postgres');
  _sql = postgres(process.env.DATABASE_URL, {
    ssl: { rejectUnauthorized: false },
    max: 10,
    idle_timeout: 30,
  });
  _sql.sql = _sql;
  return _sql;
}

module.exports = { db };

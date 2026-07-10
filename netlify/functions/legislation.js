const { db } = require('../../lib/db');
const auth = require('../../lib/auth');
const { json, parseBody, pathSegmentsAfter } = require('../../lib/http');

exports.handler = async (event) => {
  const authResult = auth.requireAuth(event);
  if (authResult.error) return authResult.error;

  const sql = db();
  const segments = pathSegmentsAfter(event, '/legislation');
  const method = event.httpMethod;
  const userId = authResult.session.sub;

  try {
    if (segments.length === 0) {
      if (method === 'GET') {
        const qp = event.queryStringParameters || {};
        const rows = await sql.sql`
          SELECT lu.*, (lr.id IS NOT NULL) AS lida
          FROM legislation_updates lu
          LEFT JOIN legislation_reads lr ON lr.legislation_id = lu.id AND lr.user_id = ${userId}
          WHERE lu.ativo = TRUE
          ORDER BY lu.criado_em DESC
        `;
        const result = qp.unread ? rows.filter((r) => !r.lida) : rows;
        return json(200, { legislation: result });
      }
      if (method === 'POST') {
        const adminCheck = auth.requireAdmin(event);
        if (adminCheck.error) return adminCheck.error;
        const { titulo, descricao, link } = parseBody(event);
        if (!titulo) return json(400, { error: 'Informe o titulo da atualizacao.' });
        const rows = await sql.sql`
          INSERT INTO legislation_updates (titulo, descricao, link, criado_por) VALUES (${titulo}, ${descricao || null}, ${link || null}, ${userId}) RETURNING *
        `;
        return json(201, { legislation: rows[0] });
      }
      return json(405, { error: 'Metodo nao permitido' });
    }

    const legId = Number(segments[0]);

    if (segments.length === 2 && segments[1] === 'read' && method === 'POST') {
      await sql.sql`
        INSERT INTO legislation_reads (legislation_id, user_id) VALUES (${legId}, ${userId})
        ON CONFLICT (legislation_id, user_id) DO NOTHING
      `;
      return json(200, { ok: true });
    }

    if (segments.length === 1) {
      if (method === 'PUT') {
        const adminCheck = auth.requireAdmin(event);
        if (adminCheck.error) return adminCheck.error;
        const { titulo, descricao, link, ativo } = parseBody(event);
        const rows = await sql.sql`
          UPDATE legislation_updates SET
            titulo = COALESCE(${titulo}, titulo), descricao = COALESCE(${descricao}, descricao),
            link = COALESCE(${link}, link), ativo = COALESCE(${ativo}, ativo)
          WHERE id = ${legId} RETURNING *
        `;
        if (!rows[0]) return json(404, { error: 'Nao encontrado' });
        return json(200, { legislation: rows[0] });
      }
      if (method === 'DELETE') {
        const adminCheck = auth.requireAdmin(event);
        if (adminCheck.error) return adminCheck.error;
        await sql.sql`DELETE FROM legislation_updates WHERE id = ${legId}`;
        return json(200, { ok: true });
      }
    }

    return json(404, { error: 'Rota nao encontrada' });
  } catch (err) {
    return json(500, { error: 'Erro interno', details: String(err && err.message || err) });
  }
};

const { db } = require('../../lib/db');
const auth = require('../../lib/auth');
const { json, parseBody, pathSegmentsAfter } = require('../../lib/http');
const { computeAlert } = require('../../lib/license-utils');
const { documentsStore } = require('../../lib/blobs');

function withAlert(row) {
  const alert = computeAlert(row.validade, row.renovacao_lead_days);
  return { ...row, ...alert };
}

exports.handler = async (event) => {
  const authResult = auth.requireAuth(event);
  if (authResult.error) return authResult.error;

  const sql = db();
  const segments = pathSegmentsAfter(event, '/licenses');
  const method = event.httpMethod;

  try {
    if (segments.length === 0) {
      if (method === 'GET') {
        const qp = event.queryStringParameters || {};
        const rows = await sql.sql`
          SELECT l.*, c.name AS cliente_nome, c.cnpj AS cliente_cnpj
          FROM licenses l JOIN clients c ON c.id = l.client_id
          ORDER BY l.validade ASC NULLS LAST
        `;
        let result = rows.map(withAlert);
        if (qp.clientId) result = result.filter((r) => String(r.client_id) === String(qp.clientId));
        if (qp.nivel) result = result.filter((r) => r.nivel === qp.nivel);
        if (qp.q) {
          const needle = qp.q.toLowerCase();
          result = result.filter((r) =>
            (r.descricao || '').toLowerCase().includes(needle) ||
            (r.numero || '').toLowerCase().includes(needle) ||
            (r.cliente_nome || '').toLowerCase().includes(needle)
          );
        }
        return json(200, { licenses: result });
      }
      if (method === 'POST') {
        const b = parseBody(event);
        if (!b.clientId || !b.descricao) return json(400, { error: 'Informe ao menos cliente e descricao do documento.' });

        let blobKey = null;
        let blobName = null;
        if (b.documentoBase64 && b.documentoNomeOriginal) {
          blobKey = `${b.clientId}/${Date.now()}-${b.documentoNomeOriginal}`.replace(/[^a-zA-Z0-9/_.-]/g, '_');
          const buffer = Buffer.from(b.documentoBase64, 'base64');
          await documentsStore().set(blobKey, buffer);
          blobName = b.documentoNomeOriginal;
        }

        const rows = await sql.sql`
          INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel,
            emissao, validade, renovacao_lead_days, info_adicional, documento_blob_key, documento_nome, auto_enviar_aviso)
          VALUES (${b.clientId}, ${b.classe || null}, ${b.unidade || null}, ${b.descricao}, ${b.numero || null},
            ${b.orgaoExpeditor || null}, ${b.responsavel || null}, ${b.emissao || null}, ${b.validade || null},
            ${b.renovacaoLeadDays || 60}, ${b.infoAdicional || null}, ${blobKey},
            ${blobName}, ${!!b.autoEnviarAviso})
          RETURNING *
        `;
        return json(201, { license: withAlert(rows[0]) });
      }
      return json(405, { error: 'Metodo nao permitido' });
    }

    const licenseId = Number(segments[0]);
    if (!Number.isInteger(licenseId)) return json(400, { error: 'Licenca invalida' });

    if (segments.length === 1) {
      if (method === 'GET') {
        const rows = await sql.sql`
          SELECT l.*, c.name AS cliente_nome, c.cnpj AS cliente_cnpj
          FROM licenses l JOIN clients c ON c.id = l.client_id WHERE l.id = ${licenseId}
        `;
        if (!rows[0]) return json(404, { error: 'Licenca nao encontrada' });
        return json(200, { license: withAlert(rows[0]) });
      }
      if (method === 'PUT') {
        const b = parseBody(event);
        const rows = await sql.sql`
          UPDATE licenses SET
            classe = COALESCE(${b.classe}, classe),
            unidade = COALESCE(${b.unidade}, unidade),
            descricao = COALESCE(${b.descricao}, descricao),
            numero = COALESCE(${b.numero}, numero),
            orgao_expeditor = COALESCE(${b.orgaoExpeditor}, orgao_expeditor),
            responsavel = COALESCE(${b.responsavel}, responsavel),
            emissao = COALESCE(${b.emissao}, emissao),
            validade = COALESCE(${b.validade}, validade),
            renovacao_lead_days = COALESCE(${b.renovacaoLeadDays}, renovacao_lead_days),
            info_adicional = COALESCE(${b.infoAdicional}, info_adicional),
            documento_blob_key = COALESCE(${b.documentoBlobKey}, documento_blob_key),
            documento_nome = COALESCE(${b.documentoNome}, documento_nome),
            auto_enviar_aviso = COALESCE(${b.autoEnviarAviso}, auto_enviar_aviso),
            status = COALESCE(${b.status}, status),
            updated_at = NOW()
          WHERE id = ${licenseId} RETURNING *
        `;
        if (!rows[0]) return json(404, { error: 'Licenca nao encontrada' });
        return json(200, { license: withAlert(rows[0]) });
      }
      if (method === 'DELETE') {
        await sql.sql`DELETE FROM licenses WHERE id = ${licenseId}`;
        return json(200, { ok: true });
      }
      return json(405, { error: 'Metodo nao permitido' });
    }

    if (segments[1] === 'document' && method === 'GET') {
      const rows = await sql.sql`SELECT documento_blob_key, documento_nome FROM licenses WHERE id = ${licenseId}`;
      const lic = rows[0];
      if (!lic || !lic.documento_blob_key) return json(404, { error: 'Documento nao encontrado' });
      const store = documentsStore();
      const blob = await store.get(lic.documento_blob_key, { type: 'arrayBuffer' });
      if (!blob) return json(404, { error: 'Arquivo nao encontrado no armazenamento' });
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `inline; filename="${(lic.documento_nome || 'documento').replace(/"/g, '')}"`,
        },
        body: Buffer.from(blob).toString('base64'),
        isBase64Encoded: true,
      };
    }

    return json(404, { error: 'Rota nao encontrada' });
  } catch (err) {
    return json(500, { error: 'Erro interno', details: String(err && err.message || err) });
  }
};

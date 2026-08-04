const { db } = require('../../lib/db');
const auth = require('../../lib/auth');
const { json, parseBody, pathSegmentsAfter } = require('../../lib/http');
const { computeAlert } = require('../../lib/license-utils');

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
          SELECT l.id, l.client_id, l.cnpj_id, l.classe, l.unidade, l.descricao, l.numero, l.orgao_expeditor,
            l.responsavel, l.emissao, l.validade, l.renovacao_lead_days, l.status, l.info_adicional,
            l.documento_nome, l.documento_mime, l.auto_enviar_aviso, l.created_at, l.updated_at,
            c.name AS cliente_nome, c.cnpj AS cliente_cnpj,
            cc.cnpj AS licenca_cnpj, cc.apelido AS licenca_cnpj_apelido
          FROM licenses l JOIN clients c ON c.id = l.client_id
          LEFT JOIN client_cnpjs cc ON cc.id = l.cnpj_id
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

        let documentoData = null;
        let documentoMime = null;
        let documentoNome = null;
        if (b.documentoBase64 && b.documentoNomeOriginal) {
          documentoData = Buffer.from(b.documentoBase64, 'base64');
          documentoMime = b.documentoMime || 'application/octet-stream';
          documentoNome = b.documentoNomeOriginal;
        }

        // Se um cnpjId foi informado, garante que ele pertence ao cliente selecionado.
        let cnpjId = b.cnpjId ? Number(b.cnpjId) : null;
        if (cnpjId) {
          const cnpjCheck = await sql.sql`SELECT id FROM client_cnpjs WHERE id = ${cnpjId} AND client_id = ${b.clientId}`;
          if (!cnpjCheck[0]) cnpjId = null;
        }

        const rows = await sql.sql`
          INSERT INTO licenses (client_id, cnpj_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel,
            emissao, validade, renovacao_lead_days, info_adicional, documento_data, documento_mime,
            documento_nome, auto_enviar_aviso)
          VALUES (${b.clientId}, ${cnpjId}, ${b.classe || null}, ${b.unidade || null}, ${b.descricao}, ${b.numero || null},
            ${b.orgaoExpeditor || null}, ${b.responsavel || null}, ${b.emissao || null}, ${b.validade || null},
            ${b.renovacaoLeadDays || 60}, ${b.infoAdicional || null}, ${documentoData}, ${documentoMime},
            ${documentoNome}, ${!!b.autoEnviarAviso})
          RETURNING id, client_id, cnpj_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel,
            emissao, validade, renovacao_lead_days, status, info_adicional, documento_nome, documento_mime,
            auto_enviar_aviso, created_at, updated_at
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
          SELECT l.id, l.client_id, l.cnpj_id, l.classe, l.unidade, l.descricao, l.numero, l.orgao_expeditor,
            l.responsavel, l.emissao, l.validade, l.renovacao_lead_days, l.status, l.info_adicional,
            l.documento_nome, l.documento_mime, l.auto_enviar_aviso, l.created_at, l.updated_at,
            c.name AS cliente_nome, c.cnpj AS cliente_cnpj,
            cc.cnpj AS licenca_cnpj, cc.apelido AS licenca_cnpj_apelido
          FROM licenses l JOIN clients c ON c.id = l.client_id
          LEFT JOIN client_cnpjs cc ON cc.id = l.cnpj_id
          WHERE l.id = ${licenseId}
        `;
        if (!rows[0]) return json(404, { error: 'Licenca nao encontrada' });
        return json(200, { license: withAlert(rows[0]) });
      }
      if (method === 'PUT') {
        const b = parseBody(event);

        if (b.documentoBase64 && b.documentoNomeOriginal) {
          const documentoData = Buffer.from(b.documentoBase64, 'base64');
          const documentoMime = b.documentoMime || 'application/octet-stream';
          await sql.sql`
            UPDATE licenses SET
              documento_data = ${documentoData}, documento_mime = ${documentoMime},
              documento_nome = ${b.documentoNomeOriginal}, updated_at = NOW()
            WHERE id = ${licenseId}
          `;
        }

        // cnpjId pode vir explicitamente como null (para "desvincular" o CNPJ) ou omitido (nao mexe).
        let cnpjIdUpdate = undefined;
        if (b.cnpjId !== undefined) {
          if (b.cnpjId === null || b.cnpjId === '') {
            cnpjIdUpdate = null;
          } else {
            const currentClientRows = await sql.sql`SELECT client_id FROM licenses WHERE id = ${licenseId}`;
            const targetClientId = b.clientId || (currentClientRows[0] && currentClientRows[0].client_id);
            const cnpjCheck = await sql.sql`SELECT id FROM client_cnpjs WHERE id = ${Number(b.cnpjId)} AND client_id = ${targetClientId}`;
            cnpjIdUpdate = cnpjCheck[0] ? Number(b.cnpjId) : null;
          }
        }

        const rows = await sql.sql`
          UPDATE licenses SET
            cnpj_id = ${cnpjIdUpdate !== undefined ? cnpjIdUpdate : sql.sql`cnpj_id`},
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
            auto_enviar_aviso = COALESCE(${b.autoEnviarAviso}, auto_enviar_aviso),
            status = COALESCE(${b.status}, status),
            updated_at = NOW()
          WHERE id = ${licenseId}
          RETURNING id, client_id, cnpj_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel,
            emissao, validade, renovacao_lead_days, status, info_adicional, documento_nome, documento_mime,
            auto_enviar_aviso, created_at, updated_at
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
      const rows = await sql.sql`SELECT documento_data, documento_nome, documento_mime FROM licenses WHERE id = ${licenseId}`;
      const lic = rows[0];
      if (!lic || !lic.documento_data) return json(404, { error: 'Documento nao encontrado' });
      return {
        statusCode: 200,
        headers: {
          'Content-Type': lic.documento_mime || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${(lic.documento_nome || 'documento').replace(/"/g, '')}"`,
        },
        body: Buffer.from(lic.documento_data).toString('base64'),
        isBase64Encoded: true,
      };
    }

    return json(404, { error: 'Rota nao encontrada' });
  } catch (err) {
    return json(500, { error: 'Erro interno', details: String(err && err.message || err) });
  }
};

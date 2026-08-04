const { db } = require('../../lib/db');
const auth = require('../../lib/auth');
const { json, parseBody, pathSegmentsAfter } = require('../../lib/http');

exports.handler = async (event) => {
  const authResult = auth.requireAuth(event);
  if (authResult.error) return authResult.error;

  const sql = db();
  const segments = pathSegmentsAfter(event, '/clients'); // ex: ["5"], ["5","contacts"], ["5","contacts","3"], ["5","required-licenses"]
  const method = event.httpMethod;

  try {
    // /api/clients
    if (segments.length === 0) {
      if (method === 'GET') {
        const q = (event.queryStringParameters && event.queryStringParameters.q) || '';
        const rows = q
          ? await sql.sql`SELECT * FROM clients WHERE name ILIKE ${'%' + q + '%'} OR cnpj ILIKE ${'%' + q + '%'} ORDER BY name`
          : await sql.sql`SELECT * FROM clients ORDER BY name`;
        return json(200, { clients: rows });
      }
      if (method === 'POST') {
        const { name, cnpj, notes } = parseBody(event);
        if (!name) return json(400, { error: 'Informe o nome do cliente.' });
        const rows = await sql.sql`INSERT INTO clients (name, cnpj, notes) VALUES (${name}, ${cnpj || null}, ${notes || null}) RETURNING *`;
        return json(201, { client: rows[0] });
      }
      return json(405, { error: 'Metodo nao permitido' });
    }

    const clientId = Number(segments[0]);
    if (!Number.isInteger(clientId)) return json(400, { error: 'Cliente invalido' });

    // /api/clients/:id
    if (segments.length === 1) {
      if (method === 'GET') {
        const clientRows = await sql.sql`SELECT * FROM clients WHERE id = ${clientId}`;
        if (!clientRows[0]) return json(404, { error: 'Cliente nao encontrado' });
        const licenses = await sql.sql`
          SELECT l.*, cc.cnpj AS licenca_cnpj, cc.apelido AS licenca_cnpj_apelido
          FROM licenses l LEFT JOIN client_cnpjs cc ON cc.id = l.cnpj_id
          WHERE l.client_id = ${clientId} ORDER BY l.validade ASC NULLS LAST`;
        const contacts = await sql.sql`SELECT * FROM client_contacts WHERE client_id = ${clientId} ORDER BY id`;
        const required = await sql.sql`SELECT * FROM client_required_licenses WHERE client_id = ${clientId} ORDER BY tipo`;
        const cnpjs = await sql.sql`SELECT * FROM client_cnpjs WHERE client_id = ${clientId} ORDER BY id`;
        return json(200, { client: clientRows[0], licenses, contacts, requiredLicenses: required, cnpjs });
      }
      if (method === 'PUT') {
        const { name, cnpj, notes, status } = parseBody(event);
        const rows = await sql.sql`UPDATE clients SET name = COALESCE(${name}, name), cnpj = ${cnpj}, notes = ${notes}, status = COALESCE(${status}, status), updated_at = NOW() WHERE id = ${clientId} RETURNING *`;
        if (!rows[0]) return json(404, { error: 'Cliente nao encontrado' });
        return json(200, { client: rows[0] });
      }
      if (method === 'DELETE') {
        const adminCheck = auth.requireAdmin(event);
        if (adminCheck.error) return adminCheck.error;
        await sql.sql`DELETE FROM clients WHERE id = ${clientId}`;
        return json(200, { ok: true });
      }
      return json(405, { error: 'Metodo nao permitido' });
    }

    // /api/clients/:id/contacts[/:contactId]
    if (segments[1] === 'contacts') {
      if (segments.length === 2) {
        if (method === 'GET') {
          const rows = await sql.sql`SELECT * FROM client_contacts WHERE client_id = ${clientId} ORDER BY id`;
          return json(200, { contacts: rows });
        }
        if (method === 'POST') {
          const { nome, email, receberAlertas } = parseBody(event);
          if (!email) return json(400, { error: 'Informe o e-mail do contato.' });
          const rows = await sql.sql`INSERT INTO client_contacts (client_id, nome, email, receber_alertas) VALUES (${clientId}, ${nome || null}, ${email}, ${receberAlertas !== false}) RETURNING *`;
          return json(201, { contact: rows[0] });
        }
      }
      if (segments.length === 3) {
        const contactId = Number(segments[2]);
        if (method === 'PUT') {
          const { nome, email, receberAlertas } = parseBody(event);
          const rows = await sql.sql`UPDATE client_contacts SET nome = COALESCE(${nome}, nome), email = COALESCE(${email}, email), receber_alertas = COALESCE(${receberAlertas}, receber_alertas) WHERE id = ${contactId} AND client_id = ${clientId} RETURNING *`;
          if (!rows[0]) return json(404, { error: 'Contato nao encontrado' });
          return json(200, { contact: rows[0] });
        }
        if (method === 'DELETE') {
          await sql.sql`DELETE FROM client_contacts WHERE id = ${contactId} AND client_id = ${clientId}`;
          return json(200, { ok: true });
        }
      }
      return json(405, { error: 'Metodo nao permitido' });
    }

    // /api/clients/:id/required-licenses[/:reqId]
    if (segments[1] === 'required-licenses') {
      if (segments.length === 2) {
        if (method === 'GET') {
          const rows = await sql.sql`SELECT * FROM client_required_licenses WHERE client_id = ${clientId} ORDER BY tipo`;
          return json(200, { requiredLicenses: rows });
        }
        if (method === 'POST') {
          const { tipo, observacao } = parseBody(event);
          if (!tipo) return json(400, { error: 'Informe o tipo de licenca.' });
          const rows = await sql.sql`INSERT INTO client_required_licenses (client_id, tipo, observacao) VALUES (${clientId}, ${tipo}, ${observacao || null}) RETURNING *`;
          return json(201, { requiredLicense: rows[0] });
        }
      }
      if (segments.length === 3) {
        const reqId = Number(segments[2]);
        if (method === 'DELETE') {
          await sql.sql`DELETE FROM client_required_licenses WHERE id = ${reqId} AND client_id = ${clientId}`;
          return json(200, { ok: true });
        }
      }
      return json(405, { error: 'Metodo nao permitido' });
    }

    // /api/clients/:id/cnpjs[/:cnpjId]  (um cliente pode ter mais de um CNPJ, ex.: filiais)
    if (segments[1] === 'cnpjs') {
      if (segments.length === 2) {
        if (method === 'GET') {
          const rows = await sql.sql`SELECT * FROM client_cnpjs WHERE client_id = ${clientId} ORDER BY id`;
          return json(200, { cnpjs: rows });
        }
        if (method === 'POST') {
          const { cnpj, apelido } = parseBody(event);
          if (!cnpj || !cnpj.trim()) return json(400, { error: 'Informe o CNPJ.' });
          const clientCheck = await sql.sql`SELECT id FROM clients WHERE id = ${clientId}`;
          if (!clientCheck[0]) return json(404, { error: 'Cliente nao encontrado' });
          const rows = await sql.sql`INSERT INTO client_cnpjs (client_id, cnpj, apelido) VALUES (${clientId}, ${cnpj.trim()}, ${apelido || null}) RETURNING *`;
          return json(201, { cnpj: rows[0] });
        }
      }
      if (segments.length === 3) {
        const cnpjId = Number(segments[2]);
        if (method === 'PUT') {
          const { cnpj, apelido } = parseBody(event);
          const rows = await sql.sql`
            UPDATE client_cnpjs SET
              cnpj = COALESCE(${cnpj && cnpj.trim() ? cnpj.trim() : null}, cnpj),
              apelido = ${apelido !== undefined ? apelido : sql.sql`apelido`}
            WHERE id = ${cnpjId} AND client_id = ${clientId} RETURNING *`;
          if (!rows[0]) return json(404, { error: 'CNPJ nao encontrado' });
          return json(200, { cnpj: rows[0] });
        }
        if (method === 'DELETE') {
          await sql.sql`DELETE FROM client_cnpjs WHERE id = ${cnpjId} AND client_id = ${clientId}`;
          return json(200, { ok: true });
        }
      }
      return json(405, { error: 'Metodo nao permitido' });
    }

    return json(404, { error: 'Rota nao encontrada' });
  } catch (err) {
    return json(500, { error: 'Erro interno', details: String(err && err.message || err) });
  }
};

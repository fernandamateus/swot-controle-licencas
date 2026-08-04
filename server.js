'use strict';
// =====================================================================
// Swot - Controle de Licencas e Autorizacoes
// Servidor Express.js para DigitalOcean App Platform
// =====================================================================
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const postgres = require('postgres');

const auth = require('./lib/auth');
const token = require('./lib/token');
const { analyzeDocument } = require('./lib/anthropic');
const { extractFromPDF } = require('./lib/pdf-extractor');
const { sendMail, TEMPLATES, formatDate } = require('./lib/mailer');
const { computeAlert } = require('./lib/license-utils');

// === Banco de dados ===
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

// === Aplicacao Express ===
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// === Helpers de autenticacao ===
function getSession(req) {
  // Reutiliza a logica existente de auth.js passando headers no formato esperado
  return auth.getSessionFromEvent({ headers: req.headers });
}

function checkAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Sessao expirada. Faca login novamente.' });
    return null;
  }
  return session;
}

function checkAdmin(req, res) {
  const session = checkAuth(req, res);
  if (!session) return null;
  if (session.role !== 'admin_master') {
    res.status(403).json({ error: 'Apenas o Admin master pode realizar esta acao.' });
    return null;
  }
  return session;
}

function withAlert(row) {
  return { ...row, ...computeAlert(row.validade, row.renovacao_lead_days) };
}

// =====================================================================
// ROTAS DE AUTENTICACAO
// =====================================================================

// POST /api/login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' });

    const sql = db();
    const rows = await sql`SELECT * FROM users WHERE email = ${String(email).toLowerCase().trim()}`;
    const user = rows[0];
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const sessionToken = token.sign({ sub: user.id, role: user.role, name: user.name, email: user.email });
    res.setHeader('Set-Cookie', auth.buildSessionCookie(sessionToken));
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.must_change_password },
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', auth.buildClearCookie());
  res.json({ ok: true });
});

// GET /api/me
app.get('/api/me', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const sql = db();
    const rows = await sql`SELECT id, name, email, role, must_change_password FROM users WHERE id = ${session.sub}`;
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Usuario nao encontrado.' });

    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.must_change_password } });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// POST /api/change-password
app.post('/api/change-password', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'A nova senha deve ter ao menos 8 caracteres.' });
    }

    const sql = db();
    const rows = await sql`SELECT * FROM users WHERE id = ${session.sub}`;
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Usuario nao encontrado.' });

    if (!user.must_change_password) {
      if (!currentPassword || !auth.verifyPassword(currentPassword, user.password_hash)) {
        return res.status(400).json({ error: 'Senha atual incorreta.' });
      }
    }

    const newHash = auth.hashPassword(newPassword);
    await sql`UPDATE users SET password_hash = ${newHash}, must_change_password = FALSE WHERE id = ${user.id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// =====================================================================
// ROTAS DE USUARIOS (admin)
// =====================================================================

// GET /api/users
app.get('/api/users', async (req, res) => {
  try {
    const session = checkAdmin(req, res);
    if (!session) return;

    const sql = db();
    const rows = await sql`SELECT id, name, email, role, must_change_password, created_at FROM users ORDER BY id`;
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// POST /api/users/:id/reset-password
app.post('/api/users/:id/reset-password', async (req, res) => {
  try {
    const session = checkAdmin(req, res);
    if (!session) return;

    const userId = Number(req.params.id);
    const { newPassword } = req.body || {};
    if (!userId || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Informe o usuario e uma nova senha com ao menos 8 caracteres.' });
    }

    const sql = db();
    const newHash = auth.hashPassword(newPassword);
    await sql`UPDATE users SET password_hash = ${newHash}, must_change_password = TRUE WHERE id = ${userId}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// POST /api/reset-password — alias para compatibilidade com frontend (envia userId no body)
app.post('/api/reset-password', async (req, res) => {
  try {
    const session = checkAdmin(req, res);
    if (!session) return;

    const { userId, newPassword } = req.body || {};
    if (!userId || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Informe o usuario e uma nova senha com ao menos 8 caracteres.' });
    }

    const sql = db();
    const newHash = auth.hashPassword(newPassword);
    await sql`UPDATE users SET password_hash = ${newHash}, must_change_password = TRUE WHERE id = ${Number(userId)}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// POST /api/emergency-reset — ativo apenas quando EMERGENCY_RESET_SECRET esta configurado no Railway
app.post('/api/emergency-reset', async (req, res) => {
  try {
    const envSecret = process.env.EMERGENCY_RESET_SECRET;
    if (!envSecret) return res.status(404).json({ error: 'Endpoint nao disponivel.' });
    const { secret } = req.body || {};
    if (secret !== envSecret) return res.status(403).json({ error: 'Acesso negado.' });

    const sql = db();
    const h1 = auth.hashPassword('Swot2024!Fer');
    const h2 = auth.hashPassword('Swot2024!Tha');
    await sql`UPDATE users SET password_hash = ${h1}, must_change_password = TRUE WHERE email = 'fernanda@swot.net.br'`;
    await sql`UPDATE users SET password_hash = ${h2}, must_change_password = TRUE WHERE email = 'thaynara@swot.net.br'`;
    res.json({ ok: true, fernanda: 'Swot2024!Fer', thaynara: 'Swot2024!Tha' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// =====================================================================
// ROTAS DE ALERTAS
// =====================================================================

// GET /api/alerts
app.get('/api/alerts', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const sql = db();
    const rows = await sql`
      SELECT l.id, l.client_id, l.cnpj_id, l.classe, l.unidade, l.descricao, l.numero, l.orgao_expeditor,
        l.responsavel, l.emissao, l.validade, l.renovacao_lead_days, l.status, l.info_adicional,
        l.documento_nome, l.auto_enviar_aviso, c.name AS cliente_nome,
        cc.cnpj AS licenca_cnpj, cc.apelido AS licenca_cnpj_apelido
      FROM licenses l JOIN clients c ON c.id = l.client_id
      LEFT JOIN client_cnpjs cc ON cc.id = l.cnpj_id
    `;
    const withAlerts = rows.map((r) => ({ ...r, ...computeAlert(r.validade, r.renovacao_lead_days) }));

    res.json({
      resumo: {
        vencidos: withAlerts.filter((r) => r.nivel === 'vencido').length,
        criticos: withAlerts.filter((r) => r.nivel === 'critico').length,
        atencao: withAlerts.filter((r) => r.nivel === 'atencao').length,
        alerta: withAlerts.filter((r) => r.nivel === 'alerta').length,
        total: rows.length,
      },
      vencidos: withAlerts.filter((r) => r.nivel === 'vencido'),
      criticos: withAlerts.filter((r) => r.nivel === 'critico'),
      atencao: withAlerts.filter((r) => r.nivel === 'atencao'),
      alerta: withAlerts.filter((r) => r.nivel === 'alerta'),
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// =====================================================================
// ROTAS DE CLIENTES
// =====================================================================

// GET /api/clients
app.get('/api/clients', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const sql = db();
    const q = req.query.q || '';
    const rows = q
      ? await sql`SELECT * FROM clients WHERE name ILIKE ${'%' + q + '%'} OR cnpj ILIKE ${'%' + q + '%'} ORDER BY name`
      : await sql`SELECT * FROM clients ORDER BY name`;
    res.json({ clients: rows });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// POST /api/clients
app.post('/api/clients', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const { name, cnpj, notes } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome do cliente.' });

    const sql = db();
    const rows = await sql`INSERT INTO clients (name, cnpj, notes) VALUES (${name}, ${cnpj || null}, ${notes || null}) RETURNING *`;
    res.status(201).json({ client: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// GET /api/clients/:id
app.get('/api/clients/:id', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const sql = db();
    const clientRows = await sql`SELECT * FROM clients WHERE id = ${clientId}`;
    if (!clientRows[0]) return res.status(404).json({ error: 'Cliente nao encontrado' });

    const licenses = await sql`
      SELECT l.id, l.client_id, l.cnpj_id, l.classe, l.unidade, l.descricao, l.numero, l.orgao_expeditor, l.responsavel,
        l.emissao, l.validade, l.renovacao_lead_days, l.status, l.info_adicional, l.documento_nome,
        l.auto_enviar_aviso, l.created_at, l.updated_at,
        cc.cnpj AS licenca_cnpj, cc.apelido AS licenca_cnpj_apelido
      FROM licenses l LEFT JOIN client_cnpjs cc ON cc.id = l.cnpj_id
      WHERE l.client_id = ${clientId} ORDER BY l.validade ASC NULLS LAST`;
    const contacts = await sql`SELECT * FROM client_contacts WHERE client_id = ${clientId} ORDER BY id`;
    const required = await sql`SELECT * FROM client_required_licenses WHERE client_id = ${clientId} ORDER BY tipo`;
    const cnpjs = await sql`SELECT * FROM client_cnpjs WHERE client_id = ${clientId} ORDER BY id`;

    res.json({ client: clientRows[0], licenses, contacts, requiredLicenses: required, cnpjs });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// PUT /api/clients/:id
app.put('/api/clients/:id', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const { name, cnpj, notes, status } = req.body || {};
    const sql = db();
    const rows = await sql`
      UPDATE clients SET name = COALESCE(${name}, name), cnpj = ${cnpj !== undefined ? cnpj : sql`cnpj`},
        notes = ${notes !== undefined ? notes : sql`notes`}, status = COALESCE(${status}, status), updated_at = NOW()
      WHERE id = ${clientId} RETURNING *`;
    if (!rows[0]) return res.status(404).json({ error: 'Cliente nao encontrado' });
    res.json({ client: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// DELETE /api/clients/:id
app.delete('/api/clients/:id', async (req, res) => {
  try {
    const session = checkAdmin(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const sql = db();
    await sql`DELETE FROM clients WHERE id = ${clientId}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// =====================================================================
// ROTAS DE CONTATOS DO CLIENTE
// =====================================================================

// GET /api/clients/:id/contacts
app.get('/api/clients/:id/contacts', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const sql = db();
    const rows = await sql`SELECT * FROM client_contacts WHERE client_id = ${clientId} ORDER BY id`;
    res.json({ contacts: rows });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// POST /api/clients/:id/contacts
app.post('/api/clients/:id/contacts', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const { nome, email, receberAlertas } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Informe o e-mail do contato.' });

    const sql = db();
    const rows = await sql`
      INSERT INTO client_contacts (client_id, nome, email, receber_alertas)
      VALUES (${clientId}, ${nome || null}, ${email}, ${receberAlertas !== false}) RETURNING *`;
    res.status(201).json({ contact: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// PUT /api/clients/:id/contacts/:cid
app.put('/api/clients/:id/contacts/:cid', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const contactId = Number(req.params.cid);
    const { nome, email, receberAlertas } = req.body || {};

    const sql = db();
    const rows = await sql`
      UPDATE client_contacts SET
        nome = COALESCE(${nome}, nome), email = COALESCE(${email}, email),
        receber_alertas = COALESCE(${receberAlertas !== undefined ? receberAlertas : null}, receber_alertas)
      WHERE id = ${contactId} AND client_id = ${clientId} RETURNING *`;
    if (!rows[0]) return res.status(404).json({ error: 'Contato nao encontrado' });
    res.json({ contact: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// DELETE /api/clients/:id/contacts/:cid
app.delete('/api/clients/:id/contacts/:cid', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const contactId = Number(req.params.cid);
    const sql = db();
    await sql`DELETE FROM client_contacts WHERE id = ${contactId} AND client_id = ${clientId}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// =====================================================================
// ROTAS DE LICENCAS OBRIGATORIAS DO CLIENTE
// =====================================================================

// GET /api/clients/:id/required-licenses
app.get('/api/clients/:id/required-licenses', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const sql = db();
    const rows = await sql`SELECT * FROM client_required_licenses WHERE client_id = ${clientId} ORDER BY tipo`;
    res.json({ requiredLicenses: rows });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// POST /api/clients/:id/required-licenses
app.post('/api/clients/:id/required-licenses', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const { tipo, observacao } = req.body || {};
    if (!tipo) return res.status(400).json({ error: 'Informe o tipo de licenca.' });

    const sql = db();
    const rows = await sql`
      INSERT INTO client_required_licenses (client_id, tipo, observacao) VALUES (${clientId}, ${tipo}, ${observacao || null}) RETURNING *`;
    res.status(201).json({ requiredLicense: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// DELETE /api/clients/:id/required-licenses/:rid
app.delete('/api/clients/:id/required-licenses/:rid', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const reqId = Number(req.params.rid);
    const sql = db();
    await sql`DELETE FROM client_required_licenses WHERE id = ${reqId} AND client_id = ${clientId}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// =====================================================================
// ROTAS DE CNPJs DO CLIENTE (um cliente pode ter mais de um CNPJ)
// =====================================================================

// GET /api/clients/:id/cnpjs
app.get('/api/clients/:id/cnpjs', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const sql = db();
    const rows = await sql`SELECT * FROM client_cnpjs WHERE client_id = ${clientId} ORDER BY id`;
    res.json({ cnpjs: rows });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// POST /api/clients/:id/cnpjs
app.post('/api/clients/:id/cnpjs', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const { cnpj, apelido } = req.body || {};
    if (!cnpj || !cnpj.trim()) return res.status(400).json({ error: 'Informe o CNPJ.' });

    const sql = db();
    const clientRows = await sql`SELECT id FROM clients WHERE id = ${clientId}`;
    if (!clientRows[0]) return res.status(404).json({ error: 'Cliente nao encontrado' });

    const rows = await sql`
      INSERT INTO client_cnpjs (client_id, cnpj, apelido) VALUES (${clientId}, ${cnpj.trim()}, ${apelido || null}) RETURNING *`;
    res.status(201).json({ cnpj: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// PUT /api/clients/:id/cnpjs/:cid
app.put('/api/clients/:id/cnpjs/:cid', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const cnpjId = Number(req.params.cid);
    const { cnpj, apelido } = req.body || {};

    const sql = db();
    const rows = await sql`
      UPDATE client_cnpjs SET
        cnpj = COALESCE(${cnpj && cnpj.trim() ? cnpj.trim() : null}, cnpj),
        apelido = ${apelido !== undefined ? apelido : sql`apelido`}
      WHERE id = ${cnpjId} AND client_id = ${clientId} RETURNING *`;
    if (!rows[0]) return res.status(404).json({ error: 'CNPJ nao encontrado' });
    res.json({ cnpj: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// DELETE /api/clients/:id/cnpjs/:cid
app.delete('/api/clients/:id/cnpjs/:cid', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const clientId = Number(req.params.id);
    const cnpjId = Number(req.params.cid);
    const sql = db();
    // Licencas que apontavam para este CNPJ ficam sem CNPJ especifico (ON DELETE SET NULL cuida disso no banco).
    await sql`DELETE FROM client_cnpjs WHERE id = ${cnpjId} AND client_id = ${clientId}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// =====================================================================
// ROTAS DE LICENCAS
// =====================================================================

// GET /api/licenses
app.get('/api/licenses', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const sql = db();
    const rows = await sql`
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
    if (req.query.clientId) result = result.filter((r) => String(r.client_id) === String(req.query.clientId));
    if (req.query.nivel) result = result.filter((r) => r.nivel === req.query.nivel);
    if (req.query.q) {
      const needle = req.query.q.toLowerCase();
      result = result.filter((r) =>
        (r.descricao || '').toLowerCase().includes(needle) ||
        (r.numero || '').toLowerCase().includes(needle) ||
        (r.cliente_nome || '').toLowerCase().includes(needle)
      );
    }
    res.json({ licenses: result });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// POST /api/licenses
app.post('/api/licenses', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const b = req.body || {};
    if (!b.clientId || !b.descricao) return res.status(400).json({ error: 'Informe ao menos cliente e descricao do documento.' });

    let documentoData = null;
    let documentoMime = null;
    let documentoNome = null;
    if (b.documentoBase64 && b.documentoNomeOriginal) {
      documentoData = Buffer.from(b.documentoBase64, 'base64');
      documentoMime = b.documentoMime || 'application/octet-stream';
      documentoNome = b.documentoNomeOriginal;
    }

    const sql = db();

    // Se um cnpjId foi informado, garante que ele pertence ao cliente selecionado.
    let cnpjId = b.cnpjId ? Number(b.cnpjId) : null;
    if (cnpjId) {
      const cnpjCheck = await sql`SELECT id FROM client_cnpjs WHERE id = ${cnpjId} AND client_id = ${b.clientId}`;
      if (!cnpjCheck[0]) cnpjId = null;
    }

    const rows = await sql`
      INSERT INTO licenses (client_id, cnpj_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel,
        emissao, validade, renovacao_lead_days, info_adicional, documento_data, documento_mime,
        documento_nome, auto_enviar_aviso)
      VALUES (${b.clientId}, ${cnpjId}, ${b.classe || null}, ${b.unidade || null}, ${b.descricao}, ${b.numero || null},
        ${b.orgaoExpeditor || null}, ${b.responsavel || null}, ${b.emissao || null}, ${b.validade || null},
        ${b.renovacaoLeadDays || 60}, ${b.infoAdicional || null}, ${documentoData},
        ${documentoMime}, ${documentoNome}, ${!!b.autoEnviarAviso})
      RETURNING id, client_id, cnpj_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel,
        emissao, validade, renovacao_lead_days, status, info_adicional, documento_nome, documento_mime,
        auto_enviar_aviso, created_at, updated_at
    `;
    res.status(201).json({ license: withAlert(rows[0]) });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// GET /api/licenses/:id
app.get('/api/licenses/:id', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const licenseId = Number(req.params.id);
    const sql = db();
    const rows = await sql`
      SELECT l.id, l.client_id, l.cnpj_id, l.classe, l.unidade, l.descricao, l.numero, l.orgao_expeditor,
        l.responsavel, l.emissao, l.validade, l.renovacao_lead_days, l.status, l.info_adicional,
        l.documento_nome, l.documento_mime, l.auto_enviar_aviso, l.created_at, l.updated_at,
        c.name AS cliente_nome, c.cnpj AS cliente_cnpj,
        cc.cnpj AS licenca_cnpj, cc.apelido AS licenca_cnpj_apelido
      FROM licenses l JOIN clients c ON c.id = l.client_id
      LEFT JOIN client_cnpjs cc ON cc.id = l.cnpj_id
      WHERE l.id = ${licenseId}
    `;
    if (!rows[0]) return res.status(404).json({ error: 'Licenca nao encontrada' });
    res.json({ license: withAlert(rows[0]) });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// PUT /api/licenses/:id
app.put('/api/licenses/:id', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const licenseId = Number(req.params.id);
    const b = req.body || {};
    const sql = db();

    // Atualiza documento se fornecido
    if (b.documentoBase64 && b.documentoNomeOriginal) {
      const documentoData = Buffer.from(b.documentoBase64, 'base64');
      const documentoMime = b.documentoMime || 'application/octet-stream';
      await sql`
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
        const currentClientRows = await sql`SELECT client_id FROM licenses WHERE id = ${licenseId}`;
        const targetClientId = b.clientId || (currentClientRows[0] && currentClientRows[0].client_id);
        const cnpjCheck = await sql`SELECT id FROM client_cnpjs WHERE id = ${Number(b.cnpjId)} AND client_id = ${targetClientId}`;
        cnpjIdUpdate = cnpjCheck[0] ? Number(b.cnpjId) : null;
      }
    }

    const rows = await sql`
      UPDATE licenses SET
        cnpj_id = ${cnpjIdUpdate !== undefined ? cnpjIdUpdate : sql`cnpj_id`},
        classe = COALESCE(${b.classe !== undefined ? b.classe : null}, classe),
        unidade = COALESCE(${b.unidade !== undefined ? b.unidade : null}, unidade),
        descricao = COALESCE(${b.descricao || null}, descricao),
        numero = COALESCE(${b.numero !== undefined ? b.numero : null}, numero),
        orgao_expeditor = COALESCE(${b.orgaoExpeditor !== undefined ? b.orgaoExpeditor : null}, orgao_expeditor),
        responsavel = COALESCE(${b.responsavel !== undefined ? b.responsavel : null}, responsavel),
        emissao = COALESCE(${b.emissao || null}, emissao),
        validade = COALESCE(${b.validade || null}, validade),
        renovacao_lead_days = COALESCE(${b.renovacaoLeadDays || null}, renovacao_lead_days),
        info_adicional = COALESCE(${b.infoAdicional !== undefined ? b.infoAdicional : null}, info_adicional),
        auto_enviar_aviso = COALESCE(${b.autoEnviarAviso !== undefined ? b.autoEnviarAviso : null}, auto_enviar_aviso),
        status = COALESCE(${b.status || null}, status),
        updated_at = NOW()
      WHERE id = ${licenseId}
      RETURNING id, client_id, cnpj_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel,
        emissao, validade, renovacao_lead_days, status, info_adicional, documento_nome, documento_mime,
        auto_enviar_aviso, created_at, updated_at
    `;
    if (!rows[0]) return res.status(404).json({ error: 'Licenca nao encontrada' });
    res.json({ license: withAlert(rows[0]) });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// DELETE /api/licenses/:id
app.delete('/api/licenses/:id', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const licenseId = Number(req.params.id);
    const sql = db();
    await sql`DELETE FROM licenses WHERE id = ${licenseId}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// GET /api/licenses/:id/document
app.get('/api/licenses/:id/document', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const licenseId = Number(req.params.id);
    const sql = db();
    const rows = await sql`SELECT documento_data, documento_nome, documento_mime FROM licenses WHERE id = ${licenseId}`;
    const lic = rows[0];
    if (!lic || !lic.documento_data) return res.status(404).json({ error: 'Documento nao encontrado' });

    res.setHeader('Content-Type', lic.documento_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(lic.documento_nome || 'documento').replace(/"/g, '')}"`);
    res.send(Buffer.from(lic.documento_data));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// =====================================================================
// ROTAS DE LEITURA DE DOCUMENTO
// =====================================================================

// POST /api/extract-document — extração gratuita via pdf-parse (somente PDF)
app.post('/api/extract-document', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const { base64, mediaType } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'Envie o arquivo em base64.' });
    if (mediaType !== 'application/pdf') {
      return res.status(400).json({ error: 'A leitura automática gratuita funciona apenas com PDF. Para imagens, preencha os campos manualmente.' });
    }

    const extracted = await extractFromPDF(base64);
    res.json({ extracted });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// POST /api/analyze-document — leitura via IA (Anthropic) - requer ANTHROPIC_API_KEY
app.post('/api/analyze-document', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const { base64, mediaType, filename } = req.body || {};
    if (!base64 || !mediaType) return res.status(400).json({ error: 'Envie o arquivo (base64) e o tipo (mediaType).' });

    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(mediaType)) {
      return res.status(400).json({ error: 'Formato nao suportado. Envie PDF, PNG, JPG ou WEBP.' });
    }

    const extracted = await analyzeDocument({ base64, mediaType, filename });
    res.json({ extracted });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// =====================================================================
// ROTAS DE E-MAIL
// =====================================================================

// POST /api/send-email
app.post('/api/send-email', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const { licenseId, tipo, destinatarios, assuntoCustom, corpoCustom, anexarDocumentoOriginal, anexoExtra } = req.body || {};
    if (!licenseId || !tipo || !destinatarios || !destinatarios.length) {
      return res.status(400).json({ error: 'Informe a licenca, o tipo de e-mail e ao menos um destinatario.' });
    }

    const template = TEMPLATES[tipo];
    if (!template) return res.status(400).json({ error: 'Tipo de e-mail invalido.' });

    const sql = db();
    const rows = await sql`
      SELECT l.id, l.client_id, l.descricao, l.numero, l.orgao_expeditor, l.validade,
        l.renovacao_lead_days, l.documento_nome, c.name AS cliente_nome
      FROM licenses l JOIN clients c ON c.id = l.client_id WHERE l.id = ${licenseId}
    `;
    const lic = rows[0];
    if (!lic) return res.status(404).json({ error: 'Licenca nao encontrada' });

    const alert = computeAlert(lic.validade, lic.renovacao_lead_days);
    const ctx = {
      clienteNome: lic.cliente_nome,
      descricao: lic.descricao,
      numero: lic.numero,
      orgao: lic.orgao_expeditor,
      validade: lic.validade,
      diasParaVencer: alert.diasParaVencer,
    };

    const subject = assuntoCustom || template.subject(ctx);
    const html = corpoCustom || template.html(ctx);

    const attachments = [];
    if (anexarDocumentoOriginal) {
      const docRows = await sql`SELECT documento_data, documento_nome FROM licenses WHERE id = ${licenseId}`;
      if (docRows[0]?.documento_data) {
        attachments.push({ filename: docRows[0].documento_nome || 'documento.pdf', content: Buffer.from(docRows[0].documento_data) });
      }
    }
    if (anexoExtra && anexoExtra.base64 && anexoExtra.filename) {
      attachments.push({ filename: anexoExtra.filename, content: Buffer.from(anexoExtra.base64, 'base64') });
    }

    let status = 'enviado';
    let erroMsg = null;
    try {
      await sendMail({ to: destinatarios.join(', '), subject, html, attachments });
    } catch (err) {
      status = 'erro';
      erroMsg = String(err.message || err);
    }

    await sql`
      INSERT INTO email_log (license_id, client_id, tipo, destinatarios, assunto, corpo, anexo_nome, enviado_por, status, erro_msg)
      VALUES (${licenseId}, ${lic.client_id}, ${tipo}, ${destinatarios.join(', ')}, ${subject}, ${html},
        ${attachments.map((a) => a.filename).join(', ') || null}, ${session.sub}, ${status}, ${erroMsg})
    `;

    if (status === 'erro') return res.status(502).json({ error: `Falha ao enviar e-mail: ${erroMsg}` });
    res.json({ ok: true, subject, preview: html, formattedValidade: formatDate(lic.validade) });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// GET /api/email-log
app.get('/api/email-log', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const sql = db();
    let rows;
    if (req.query.clientId) {
      rows = await sql`SELECT * FROM email_log WHERE client_id = ${Number(req.query.clientId)} ORDER BY criado_em DESC LIMIT 200`;
    } else if (req.query.licenseId) {
      rows = await sql`SELECT * FROM email_log WHERE license_id = ${Number(req.query.licenseId)} ORDER BY criado_em DESC LIMIT 200`;
    } else {
      rows = await sql`SELECT * FROM email_log ORDER BY criado_em DESC LIMIT 200`;
    }
    res.json({ emails: rows });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// =====================================================================
// ROTAS DE LEGISLACAO
// =====================================================================

// GET /api/legislation
app.get('/api/legislation', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const sql = db();
    const userId = session.sub;
    const rows = await sql`
      SELECT lu.*, (lr.id IS NOT NULL) AS lida
      FROM legislation_updates lu
      LEFT JOIN legislation_reads lr ON lr.legislation_id = lu.id AND lr.user_id = ${userId}
      WHERE lu.ativo = TRUE
      ORDER BY lu.criado_em DESC
    `;
    const result = req.query.unread ? rows.filter((r) => !r.lida) : rows;
    res.json({ legislation: result });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// POST /api/legislation
app.post('/api/legislation', async (req, res) => {
  try {
    const session = checkAdmin(req, res);
    if (!session) return;

    const { titulo, descricao, link } = req.body || {};
    if (!titulo) return res.status(400).json({ error: 'Informe o titulo da atualizacao.' });

    const sql = db();
    const rows = await sql`
      INSERT INTO legislation_updates (titulo, descricao, link, criado_por)
      VALUES (${titulo}, ${descricao || null}, ${link || null}, ${session.sub}) RETURNING *
    `;
    res.status(201).json({ legislation: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// PUT /api/legislation/:id
app.put('/api/legislation/:id', async (req, res) => {
  try {
    const session = checkAdmin(req, res);
    if (!session) return;

    const legId = Number(req.params.id);
    const { titulo, descricao, link, ativo } = req.body || {};

    const sql = db();
    const rows = await sql`
      UPDATE legislation_updates SET
        titulo = COALESCE(${titulo || null}, titulo),
        descricao = COALESCE(${descricao !== undefined ? descricao : null}, descricao),
        link = COALESCE(${link !== undefined ? link : null}, link),
        ativo = COALESCE(${ativo !== undefined ? ativo : null}, ativo)
      WHERE id = ${legId} RETURNING *
    `;
    if (!rows[0]) return res.status(404).json({ error: 'Nao encontrado' });
    res.json({ legislation: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// DELETE /api/legislation/:id
app.delete('/api/legislation/:id', async (req, res) => {
  try {
    const session = checkAdmin(req, res);
    if (!session) return;

    const legId = Number(req.params.id);
    const sql = db();
    await sql`DELETE FROM legislation_updates WHERE id = ${legId}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// POST /api/legislation/:id/read
app.post('/api/legislation/:id/read', async (req, res) => {
  try {
    const session = checkAuth(req, res);
    if (!session) return;

    const legId = Number(req.params.id);
    const sql = db();
    await sql`
      INSERT INTO legislation_reads (legislation_id, user_id) VALUES (${legId}, ${session.sub})
      ON CONFLICT (legislation_id, user_id) DO NOTHING
    `;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno', details: String(err.message || err) });
  }
});

// =====================================================================
// ALERTAS AUTOMATICOS (CRON)
// =====================================================================

async function runScheduledAlerts() {
  const sql = db();
  const MILESTONES = [60, 30, 15, 7, 3, 1, 0];

  try {
    const licenses = await sql`
      SELECT l.id, l.client_id, l.descricao, l.numero, l.orgao_expeditor, l.validade,
        l.renovacao_lead_days, c.name AS cliente_nome
      FROM licenses l JOIN clients c ON c.id = l.client_id WHERE l.auto_enviar_aviso = TRUE
    `;

    let enviados = 0;
    const erros = [];

    for (const lic of licenses) {
      const alert = computeAlert(lic.validade, lic.renovacao_lead_days);
      if (alert.diasParaVencer == null || !MILESTONES.includes(alert.diasParaVencer)) continue;

      const already = await sql`
        SELECT id FROM email_log WHERE license_id = ${lic.id} AND tipo = 'aviso_renovacao' AND criado_em > NOW() - INTERVAL '20 hours'
      `;
      if (already.length) continue;

      const contacts = await sql`
        SELECT email FROM client_contacts WHERE client_id = ${lic.client_id} AND receber_alertas = TRUE
      `;
      if (!contacts.length) continue;

      const template = TEMPLATES.aviso_renovacao;
      const ctx = {
        clienteNome: lic.cliente_nome,
        descricao: lic.descricao,
        numero: lic.numero,
        orgao: lic.orgao_expeditor,
        validade: lic.validade,
        diasParaVencer: alert.diasParaVencer,
      };
      const subject = template.subject(ctx);
      const html = template.html(ctx);
      const destinatarios = contacts.map((c) => c.email);

      let status = 'enviado';
      let erroMsg = null;
      try {
        await sendMail({ to: destinatarios.join(', '), subject, html });
        enviados += 1;
      } catch (err) {
        status = 'erro';
        erroMsg = String(err.message || err);
        erros.push({ licenseId: lic.id, erro: erroMsg });
      }

      await sql`
        INSERT INTO email_log (license_id, client_id, tipo, destinatarios, assunto, corpo, status, erro_msg)
        VALUES (${lic.id}, ${lic.client_id}, 'aviso_renovacao', ${destinatarios.join(', ')},
          ${subject}, ${html}, ${status}, ${erroMsg})
      `;
    }

    console.log(`[CRON] Alertas: ${enviados} enviados, ${erros.length} erros`);
  } catch (err) {
    console.error('[CRON] Erro ao processar alertas:', err.message);
  }
}

// Executa todo dia as 7h (horario de Brasilia = UTC-3 → 10h UTC)
cron.schedule('0 10 * * *', runScheduledAlerts, { timezone: 'America/Sao_Paulo' });

// =====================================================================
// SPA: todas as rotas nao-API servem o index.html
// =====================================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =====================================================================
// INICIALIZACAO
// =====================================================================
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    console.log('Executando migrations do banco de dados...');
    const { runMigrations } = require('./migrate');
    await runMigrations();
    console.log('Migrations concluidas.');
  } catch (err) {
    console.error('ERRO CRITICO nas migrations:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Swot Controle de Licencas rodando na porta ${PORT}`);
  });
}

start();

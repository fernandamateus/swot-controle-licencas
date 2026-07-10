// Funcao agendada (ver netlify.toml) - roda diariamente.
// Gera o registro de alertas e, para licencas com "auto_enviar_aviso" ativado,
// envia automaticamente o e-mail de aviso de renovacao aos contatos do cliente
// nos marcos de prazo definidos em MILESTONES, evitando reenvio no mesmo dia.

const { db } = require('../../lib/db');
const { computeAlert } = require('../../lib/license-utils');
const { sendMail, TEMPLATES } = require('../../lib/mailer');

const MILESTONES = [60, 30, 15, 7, 3, 1, 0];

exports.handler = async () => {
  const sql = db();
  const licenses = await sql.sql`
    SELECT l.*, c.name AS cliente_nome FROM licenses l JOIN clients c ON c.id = l.client_id WHERE l.auto_enviar_aviso = TRUE
  `;

  let enviados = 0;
  const erros = [];

  for (const lic of licenses) {
    const alert = computeAlert(lic.validade, lic.renovacao_lead_days);
    if (alert.diasParaVencer == null || !MILESTONES.includes(alert.diasParaVencer)) continue;

    const already = await sql.sql`
      SELECT id FROM email_log WHERE license_id = ${lic.id} AND tipo = 'aviso_renovacao' AND criado_em > NOW() - INTERVAL '20 hours'
    `;
    if (already.length) continue;

    const contacts = await sql.sql`
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
      erroMsg = String(err && err.message || err);
      erros.push({ licenseId: lic.id, erro: erroMsg });
    }

    await sql.sql`
      INSERT INTO email_log (license_id, client_id, tipo, destinatarios, assunto, corpo, status, erro_msg)
      VALUES (${lic.id}, ${lic.client_id}, 'aviso_renovacao', ${destinatarios.join(', ')}, ${subject}, ${html}, ${status}, ${erroMsg})
    `;
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, enviados, erros }) };
};

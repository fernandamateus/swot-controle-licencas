const { db } = require('../../lib/db');
const auth = require('../../lib/auth');
const { json, parseBody } = require('../../lib/http');
const { sendMail, TEMPLATES, formatDate } = require('../../lib/mailer');
const { computeAlert } = require('../../lib/license-utils');
const { documentsStore } = require('../../lib/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metodo nao permitido' });
  const authResult = auth.requireAuth(event);
  if (authResult.error) return authResult.error;

  const sql = db();
  const b = parseBody(event);
  const { licenseId, tipo, destinatarios, assuntoCustom, corpoCustom, anexarDocumentoOriginal, anexoExtra } = b;

  if (!licenseId || !tipo || !destinatarios || !destinatarios.length) {
    return json(400, { error: 'Informe a licenca, o tipo de e-mail e ao menos um destinatario.' });
  }
  const template = TEMPLATES[tipo];
  if (!template) return json(400, { error: 'Tipo de e-mail invalido.' });

  try {
    const rows = await sql.sql`
      SELECT l.*, c.name AS cliente_nome FROM licenses l JOIN clients c ON c.id = l.client_id WHERE l.id = ${licenseId}
    `;
    const lic = rows[0];
    if (!lic) return json(404, { error: 'Licenca nao encontrada' });

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
    if (anexarDocumentoOriginal && lic.documento_blob_key) {
      const buf = await documentsStore().get(lic.documento_blob_key, { type: 'arrayBuffer' });
      if (buf) attachments.push({ filename: lic.documento_nome || 'documento.pdf', content: Buffer.from(buf) });
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
      erroMsg = String(err && err.message || err);
    }

    await sql.sql`
      INSERT INTO email_log (license_id, client_id, tipo, destinatarios, assunto, corpo, anexo_nome, enviado_por, status, erro_msg)
      VALUES (${licenseId}, ${lic.client_id}, ${tipo}, ${destinatarios.join(', ')}, ${subject}, ${html},
        ${attachments.map((a) => a.filename).join(', ') || null}, ${authResult.session.sub}, ${status}, ${erroMsg})
    `;

    if (status === 'erro') return json(502, { error: `Falha ao enviar e-mail: ${erroMsg}` });
    return json(200, { ok: true, subject, preview: html, formattedValidade: formatDate(lic.validade) });
  } catch (err) {
    return json(500, { error: 'Erro interno', details: String(err && err.message || err) });
  }
};

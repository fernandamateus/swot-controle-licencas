const nodemailer = require('nodemailer');

function getTransport() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error('Envio de e-mail nao configurado (defina SMTP_USER e SMTP_APP_PASSWORD nas variaveis de ambiente do site).');
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user, pass },
  });
}

async function sendMail({ to, subject, html, attachments }) {
  const transport = getTransport();
  const from = process.env.SMTP_FROM_NAME
    ? `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_USER}>`
    : process.env.SMTP_USER;
  return transport.sendMail({
    from,
    to,
    subject,
    html,
    attachments: attachments || [],
  });
}

const TEMPLATES = {
  aviso_renovacao: {
    label: 'Aviso de necessidade de renovacao',
    subject: ({ clienteNome, descricao }) => `Aviso de renovação: ${descricao} - ${clienteNome}`,
    html: ({ clienteNome, descricao, numero, orgao, validade, diasParaVencer }) => `
      <p>Olá, equipe ${escapeHtml(clienteNome)},</p>
      <p>Informamos que o documento <strong>${escapeHtml(descricao)}</strong>${numero ? ` (nº ${escapeHtml(numero)})` : ''}${orgao ? `, emitido por ${escapeHtml(orgao)}` : ''}, possui vencimento em <strong>${formatDate(validade)}</strong>.</p>
      <p>${diasParaVencer != null && diasParaVencer >= 0 ? `Faltam aproximadamente <strong>${diasParaVencer} dia(s)</strong> para o vencimento.` : 'Este documento já está vencido.'} Recomendamos iniciar o processo de renovação o quanto antes para evitar irregularidades.</p>
      <p>Qualquer dúvida, estamos à disposição.</p>
      <p>Atenciosamente,<br/>Swot - Controle de Licenças e Autorizações</p>
    `,
  },
  envio_guias: {
    label: 'Envio de guias',
    subject: ({ clienteNome, descricao }) => `Guia(s) para pagamento/regularização - ${descricao} - ${clienteNome}`,
    html: ({ clienteNome, descricao }) => `
      <p>Olá, equipe ${escapeHtml(clienteNome)},</p>
      <p>Segue em anexo a(s) guia(s) referente(s a <strong>${escapeHtml(descricao)}</strong> para pagamento/providências.</p>
      <p>Após a confirmação do pagamento, por favor nos envie o comprovante para darmos sequência ao processo.</p>
      <p>Atenciosamente,<br/>Swot - Controle de Licenças e Autorizações</p>
    `,
  },
  licenca_renovada: {
    label: 'Licença renovada',
    subject: ({ clienteNome, descricao }) => `Licença renovada: ${descricao} - ${clienteNome}`,
    html: ({ clienteNome, descricao, numero, orgao, validade }) => `
      <p>Olá, equipe ${escapeHtml(clienteNome)},</p>
      <p>Informamos que o documento <strong>${escapeHtml(descricao)}</strong>${numero ? ` (nº ${escapeHtml(numero)})` : ''}${orgao ? `, emitido por ${escapeHtml(orgao)}` : ''} foi renovado com sucesso${validade ? `, com nova validade até <strong>${formatDate(validade)}</strong>` : ''}.</p>
      <p>Segue em anexo a licença renovada.</p>
      <p>Atenciosamente,<br/>Swot - Controle de Licenças e Autorizações</p>
    `,
  },
};

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('pt-BR');
}

module.exports = { sendMail, TEMPLATES, escapeHtml, formatDate };

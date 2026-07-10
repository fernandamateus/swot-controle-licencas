const { db } = require('../../lib/db');
const auth = require('../../lib/auth');
const { json } = require('../../lib/http');
const { computeAlert } = require('../../lib/license-utils');

exports.handler = async (event) => {
  const authResult = auth.requireAuth(event);
  if (authResult.error) return authResult.error;

  const sql = db();
  const rows = await sql.sql`
    SELECT l.*, c.name AS cliente_nome FROM licenses l JOIN clients c ON c.id = l.client_id
  `;
  const withAlerts = rows.map((r) => ({ ...r, ...computeAlert(r.validade, r.renovacao_lead_days) }));
  const vencidos = withAlerts.filter((r) => r.nivel === 'vencido');
  const criticos = withAlerts.filter((r) => r.nivel === 'critico');
  const atencao = withAlerts.filter((r) => r.nivel === 'atencao');
  const alerta = withAlerts.filter((r) => r.nivel === 'alerta');

  return json(200, {
    resumo: { vencidos: vencidos.length, criticos: criticos.length, atencao: atencao.length, alerta: alerta.length, total: rows.length },
    vencidos, criticos, atencao, alerta,
  });
};

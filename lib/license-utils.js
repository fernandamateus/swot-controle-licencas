// Calculo de status/alertas de vencimento de licencas.
// Niveis: vencido (validade < hoje), critico (<=15 dias), atencao (<=30 dias),
// alerta (<=lead_days, ou seja, dentro da janela "iniciar renovacao"), ok (fora da janela).

function toDateOnly(d) {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function diffDays(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((a.getTime() - b.getTime()) / MS);
}

function computeAlert(validade, leadDays) {
  const today = toDateOnly(new Date());
  const val = toDateOnly(validade);
  const lead = Number.isFinite(leadDays) ? leadDays : 60;
  if (!val) {
    return { diasParaVencer: null, iniciarRenovacaoEm: null, nivel: 'sem_data', precisaRenovar: false };
  }
  const diasParaVencer = diffDays(val, today);
  const iniciarRenovacaoEm = new Date(val);
  iniciarRenovacaoEm.setDate(iniciarRenovacaoEm.getDate() - lead);

  let nivel = 'ok';
  if (diasParaVencer < 0) nivel = 'vencido';
  else if (diasParaVencer <= 15) nivel = 'critico';
  else if (diasParaVencer <= 30) nivel = 'atencao';
  else if (diasParaVencer <= lead) nivel = 'alerta';

  const precisaRenovar = diasParaVencer <= lead;

  return { diasParaVencer, iniciarRenovacaoEm: iniciarRenovacaoEm.toISOString().slice(0, 10), nivel, precisaRenovar };
}

module.exports = { computeAlert, toDateOnly, diffDays };

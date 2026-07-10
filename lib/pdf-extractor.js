// Extração gratuita de texto de PDFs para pré-preenchimento de campos.
// Usa pdf-parse (sem API externa, sem custo).

let pdfParse;
try { pdfParse = require('pdf-parse'); } catch { pdfParse = null; }

const MONTHS_PT = {
  janeiro: 1, fevereiro: 2, marco: 3, 'março': 3, abril: 4, maio: 5,
  junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const ORGAOS = [
  'IBAMA', 'INEA', 'IEMA', 'SEMMA', 'SEMA', 'FEPAM', 'FEAM', 'IAT', 'IAP',
  'Polícia Federal', 'Policia Federal', 'Exército', 'Exercito', 'ANVISA', 'ANTT',
  'DNIT', 'Corpo de Bombeiros', 'Bombeiros', 'CNEN', 'DETRAN', 'Receita Federal',
  'ISO', 'SASSMAQ', 'ABNT', 'INMETRO',
];

const CLASSES_MAP = {
  'Certificação':       ['certificado', 'certificação', 'certificacao', 'iso ', 'sassmaq', 'inmetro', 'abnt'],
  'Licença Transporte': ['transporte', 'antt', 'rntrc', 'transportador'],
  'Requisitos Legais':  ['alvará', 'alvara', 'funcionamento', 'corpo de bombeiro', 'vigilância', 'vigilancia', 'sanitária', 'sanitaria', 'saúde', 'saude'],
  'Transporte':         ['carga', 'frete', 'logística', 'logistica'],
};

function parseDateBR(str) {
  if (!str) return null;
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const m = str.match(/(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    if (parseInt(mo, 10) > 12 || parseInt(d, 10) > 31) return null;
    return `${y}-${mo}-${d}`;
  }
  // "15 de março de 2025"
  const mw = str.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
  if (mw) {
    const mn = MONTHS_PT[mw[2].toLowerCase()];
    if (mn) return `${mw[3]}-${String(mn).padStart(2, '0')}-${String(mw[1]).padStart(2, '0')}`;
  }
  return null;
}

function normalizeCNPJ(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 14) return null;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

async function extractFromPDF(base64) {
  if (!pdfParse) throw new Error('Dependência pdf-parse não instalada. Rode: npm install pdf-parse');

  const buffer = Buffer.from(base64, 'base64');
  const data = await pdfParse(buffer);
  const text = data.text || '';
  const textLower = text.toLowerCase();

  // ---- Datas ----
  const allDates = [];
  const dateReg = /\b(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})\b/g;
  let m;
  while ((m = dateReg.exec(text)) !== null) {
    const iso = parseDateBR(m[0]);
    if (iso) allDates.push({ raw: m[0], iso });
  }
  // Datas por extenso
  const writtenReg = /\b(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})\b/gi;
  while ((m = writtenReg.exec(text)) !== null) {
    const iso = parseDateBR(m[0]);
    if (iso) allDates.push({ raw: m[0], iso });
  }

  // Tenta encontrar datas com rótulo
  let validade = null, emissao = null;
  const validPats = [
    /valid[ao][^:\n]{0,30}[:\s]+(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/gi,
    /vencimento[^:\n]{0,20}[:\s]+(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/gi,
    /prazo[^:\n]{0,30}[:\s]+(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/gi,
    /expira[çc][ãa]o[^:\n]{0,20}[:\s]+(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/gi,
  ];
  const emisPats = [
    /emiss[ãa]o[^:\n]{0,20}[:\s]+(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/gi,
    /expedi[çc][ãa]o[^:\n]{0,20}[:\s]+(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/gi,
    /data\s+de\s+emiss[ãa]o[^:\n]{0,10}[:\s]+(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/gi,
  ];

  for (const p of validPats) { const r = p.exec(text); if (r) { validade = parseDateBR(r[1]); break; } }
  for (const p of emisPats)  { const r = p.exec(text); if (r) { emissao = parseDateBR(r[1]); break; } }

  // Fallback: menor data = emissão, maior = validade
  if (!validade && allDates.length > 0) {
    const sorted = [...allDates].sort((a, b) => a.iso.localeCompare(b.iso));
    if (sorted.length === 1) {
      validade = sorted[0].iso;
    } else {
      if (!emissao) emissao = sorted[0].iso;
      validade = sorted[sorted.length - 1].iso;
    }
  }

  // ---- CNPJ ----
  const cnpjRaw = text.match(/\d{2}[\.\s]?\d{3}[\.\s]?\d{3}[\s\/]?\d{4}[\s\-]?\d{2}/);
  const cnpj = cnpjRaw ? normalizeCNPJ(cnpjRaw[0]) : null;

  // ---- Órgão emissor ----
  let orgao = null;
  for (const org of ORGAOS) {
    if (text.includes(org)) { orgao = org; break; }
  }

  // ---- Classe ----
  let classe = 'Outro';
  for (const [cls, kws] of Object.entries(CLASSES_MAP)) {
    if (kws.some((kw) => textLower.includes(kw))) { classe = cls; break; }
  }

  // ---- Número do documento ----
  let numero = null;
  const numPatterns = [
    /n[°º\.]\s*([A-Z0-9][A-Z0-9\-\/\.]{2,25})/i,
    /n[úu]mero[:\s]+([A-Z0-9][A-Z0-9\-\/\.]{2,25})/i,
    /processo[:\s]+([0-9]{5,}[\.\-\/][A-Z0-9]+)/i,
    /registro[:\s]+([A-Z0-9][A-Z0-9\-\/\.]{2,25})/i,
    /certifica[çc][ãa]o[:\s]+([A-Z0-9][A-Z0-9\-\/\.]{2,25})/i,
  ];
  for (const p of numPatterns) {
    const r = text.match(p);
    if (r) { numero = r[1]; break; }
  }

  // ---- Descrição: primeira linha com conteúdo relevante ----
  const lines = text.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 8 && l.length < 120 && !/^\d+$/.test(l));
  const descricao = lines[0] || null;

  return {
    cliente_nome: null,
    cliente_cnpj: cnpj,
    classe,
    descricao,
    numero,
    orgao_expeditor: orgao,
    emissao,
    validade,
    responsavel: null,
    observacoes: null,
  };
}

module.exports = { extractFromPDF };

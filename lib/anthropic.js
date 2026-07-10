// Leitura automatica de licencas/autorizacoes via API da Anthropic (Claude).
// Usa fetch nativo do Node (>=18) para evitar dependencia do SDK.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

const EXTRACTION_PROMPT = `Você é um assistente especializado em documentos regulatórios brasileiros (licenças, certificados, autorizações, alvarás emitidos por órgãos como IBAMA, Polícia Federal, Exército, Corpo de Bombeiros, ANVISA, ISO, SASSMAQ, prefeituras, etc.).

Analise o documento anexado e extraia os campos abaixo. Responda APENAS com um JSON válido (sem markdown, sem comentários), no seguinte formato exato:

{
  "cliente_nome": "razão social da empresa titular do documento, se identificável, ou null",
  "cliente_cnpj": "CNPJ no formato 00.000.000/0000-00, ou null",
  "classe": "uma de: Licença Transporte, Requisitos Legais, Certificação, Transporte, Outro",
  "descricao": "nome/tipo do documento, ex: CERTIFICADO DE REGULARIDADE - CR",
  "numero": "número/identificação do documento, ou null",
  "orgao_expeditor": "órgão emissor, ex: Ibama, Polícia Federal, Exercito, ANVISA, ou null",
  "emissao": "data de emissão no formato YYYY-MM-DD, ou null",
  "validade": "data de validade/vencimento no formato YYYY-MM-DD, ou null",
  "responsavel": null,
  "observacoes": "qualquer informação relevante adicional, ou null"
}

Se não conseguir identificar um campo com confiança, use null. Não invente dados.`;

async function analyzeDocument({ base64, mediaType, filename }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Leitura por IA nao configurada (defina ANTHROPIC_API_KEY nas variaveis de ambiente do site).');
  }

  const isPdf = mediaType === 'application/pdf';
  const documentBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            documentBlock,
            { type: 'text', text: `Nome do arquivo: ${filename || 'desconhecido'}\n\n${EXTRACTION_PROMPT}` },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Erro ao consultar IA (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('IA nao retornou texto.');

  let parsed;
  try {
    const cleaned = textBlock.text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Nao foi possivel interpretar a resposta da IA como JSON.');
  }
  return parsed;
}

module.exports = { analyzeDocument };

function json(statusCode, data, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(extraHeaders || {}) },
    body: JSON.stringify(data),
  };
}

function jsonWithCookie(statusCode, data, cookie) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    multiValueHeaders: { 'Set-Cookie': [cookie] },
    body: JSON.stringify(data),
  };
}

function parseBody(event, opts) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(raw);
  } catch (err) {
    // Por padrao, mantem o comportamento antigo (corpo invalido vira {}) para nao
    // quebrar endpoints simples que nunca deveriam receber um corpo corrompido.
    // Endpoints que recebem anexos grandes (ex.: licenses.js) devem passar
    // { strict: true } para que um corpo truncado (ex.: por exceder o limite de
    // payload das Netlify Functions, ~6MB) vire um erro explicito em vez de um
    // "salvo com sucesso" silencioso sem o anexo.
    if (opts && opts.strict) {
      const sizeInfo = event.body ? ` (corpo recebido: ${event.body.length} caracteres)` : '';
      throw new Error(
        `Não foi possível interpretar os dados enviados${sizeInfo}. Isso geralmente acontece quando o arquivo anexado é grande demais. ` +
        `Tente um arquivo menor (recomendado até 4MB).`
      );
    }
    return {};
  }
}

function pathSegmentsAfter(event, prefix) {
  const path = event.path || '';
  const idx = path.indexOf(prefix);
  if (idx === -1) return [];
  const rest = path.slice(idx + prefix.length);
  return rest.split('/').filter(Boolean);
}

module.exports = { json, jsonWithCookie, parseBody, pathSegmentsAfter };

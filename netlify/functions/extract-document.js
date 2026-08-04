const auth = require('../../lib/auth');
const { json, parseBody } = require('../../lib/http');
const { extractFromPDF } = require('../../lib/pdf-extractor');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metodo nao permitido' });
  const authResult = auth.requireAuth(event);
  if (authResult.error) return authResult.error;

  const { base64, mediaType } = parseBody(event);
  if (!base64) return json(400, { error: 'Envie o arquivo em base64.' });
  if (mediaType !== 'application/pdf') {
    return json(400, { error: 'A leitura automatica gratuita funciona apenas com PDF. Para imagens, preencha os campos manualmente.' });
  }

  try {
    const extracted = await extractFromPDF(base64);
    return json(200, { extracted });
  } catch (err) {
    return json(502, { error: String(err && err.message || err) });
  }
};

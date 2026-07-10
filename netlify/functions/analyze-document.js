const auth = require('../../lib/auth');
const { json, parseBody } = require('../../lib/http');
const { analyzeDocument } = require('../../lib/anthropic');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metodo nao permitido' });
  const authResult = auth.requireAuth(event);
  if (authResult.error) return authResult.error;

  const { base64, mediaType, filename } = parseBody(event);
  if (!base64 || !mediaType) return json(400, { error: 'Envie o arquivo (base64) e o tipo (mediaType).' });

  const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
  if (!allowed.includes(mediaType)) {
    return json(400, { error: 'Formato nao suportado. Envie PDF, PNG, JPG ou WEBP.' });
  }

  try {
    const extracted = await analyzeDocument({ base64, mediaType, filename });
    return json(200, { extracted });
  } catch (err) {
    return json(502, { error: String(err && err.message || err) });
  }
};

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

function parseBody(event) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(raw);
  } catch {
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

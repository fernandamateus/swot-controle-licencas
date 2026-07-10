const crypto = require('crypto');
const token = require('./token');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  try {
    const hashVerify = crypto.scryptSync(password, salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(hashVerify, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const COOKIE_NAME = 'swot_session';

function parseCookies(headerValue) {
  const out = {};
  if (!headerValue) return out;
  headerValue.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

function buildSessionCookie(sessionToken) {
  const maxAge = 60 * 60 * 24 * 7; // 7 dias
  return `${COOKIE_NAME}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function buildClearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function getSessionFromEvent(event) {
  const cookies = parseCookies(event.headers && (event.headers.cookie || event.headers.Cookie));
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  return token.verify(raw);
}

function requireAuth(event) {
  const session = getSessionFromEvent(event);
  if (!session) {
    return { error: { statusCode: 401, body: JSON.stringify({ error: 'Sessao expirada. Faca login novamente.' }) } };
  }
  return { session };
}

function requireAdmin(event) {
  const result = requireAuth(event);
  if (result.error) return result;
  if (result.session.role !== 'admin_master') {
    return { error: { statusCode: 403, body: JSON.stringify({ error: 'Apenas o Admin master pode realizar esta acao.' }) } };
  }
  return result;
}

module.exports = {
  hashPassword,
  verifyPassword,
  buildSessionCookie,
  buildClearCookie,
  getSessionFromEvent,
  requireAuth,
  requireAdmin,
  COOKIE_NAME,
};

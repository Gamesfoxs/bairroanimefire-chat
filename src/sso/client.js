const crypto = require('crypto');
const fs = require('fs');

const ISSUER = process.env.CHAT_SSO_ISSUER || 'https://bairroanimefire.com/';
const AUDIENCE = process.env.CHAT_SSO_AUDIENCE || 'bairroanimefire-chat';
const BASE_URL = (process.env.CHAT_SSO_BASE_URL || 'https://bairroanimefire.com/auth/chat').replace(/\/$/, '');
const SKEW = 30;

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomToken(bytes = 32) {
  return b64url(crypto.randomBytes(bytes));
}

function loadSecret() {
  if (process.env.CHAT_SSO_SECRET && /^[a-f0-9]{64,}$/i.test(process.env.CHAT_SSO_SECRET.trim())) {
    return process.env.CHAT_SSO_SECRET.trim().toLowerCase();
  }
  const path = process.env.CHAT_SSO_SECRET_FILE || '/run/secrets/baf-chat-sso-secret';
  if (!fs.existsSync(path)) {
    throw new Error('Chat SSO secret unavailable');
  }
  const value = fs.readFileSync(path, 'utf8').trim();
  if (value.length < 64 || !/^[a-f0-9]+$/i.test(value)) {
    throw new Error('Chat SSO secret invalid');
  }
  return value.toLowerCase();
}

let cachedSecret = null;
function secret() {
  if (!cachedSecret) cachedSecret = loadSecret();
  return cachedSecret;
}

function canonical(payload, action) {
  const parts = [action, String(payload.timestamp), String(payload.request_id)];
  if (action === 'exchange') {
    parts.push(String(payload.code), String(payload.state), String(payload.nonce));
  } else {
    parts.push(String(payload.user_id));
  }
  return parts.join('\n');
}

function signRequest(payload, action) {
  return b64url(crypto.createHmac('sha256', secret()).update(canonical(payload, action)).digest());
}

function verifyResponse(rawBody, timestamp, signature) {
  const ts = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SKEW) {
    throw new Error('SSO response timestamp invalid');
  }
  const expected = b64url(
    crypto.createHmac('sha256', secret()).update(`${timestamp}\n${rawBody}`).digest()
  );
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('SSO response signature invalid');
  }
}

async function ssoPost(action, fields) {
  const payload = {
    ...fields,
    timestamp: Math.floor(Date.now() / 1000),
    request_id: randomToken(18),
  };
  const sig = signRequest(payload, action);
  const res = await fetch(`${BASE_URL}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BAF-SSO-Signature': sig,
      'User-Agent': 'BairroAnimeFire-Chat-SSO/1',
    },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  const ts = res.headers.get('x-baf-sso-timestamp');
  const respSig = res.headers.get('x-baf-sso-signature');
  verifyResponse(raw, ts, respSig);
  let decoded;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error('SSO response invalid');
  }
  decoded._http_status = res.status;
  return decoded;
}

function cookieOpts(maxAgeMs) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || process.env.CHAT_SSO_SECURE_COOKIES === '1',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

module.exports = {
  ISSUER,
  AUDIENCE,
  BASE_URL,
  randomToken,
  ssoPost,
  cookieOpts,
};

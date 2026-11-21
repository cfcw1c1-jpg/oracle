import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// AES-256-GCM for the Gmail and OGD passwords. The additional data binds each
// ciphertext to its chapter and credential type, so a value copied onto
// another row or column fails to decrypt instead of being used.
const VERSION = 'v1';

function loadKey() {
  const raw = process.env.OGD_CREDENTIALS_KEY;
  if (!raw) throw new Error('OGD_CREDENTIALS_KEY is not set.');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('OGD_CREDENTIALS_KEY must be 32 bytes, base64 encoded.');
  return key;
}

function additionalData(areaId, kind) {
  return Buffer.from(`ogd:${areaId}:${kind}`, 'utf8');
}

export function encryptSecret(plaintext, areaId, kind) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
  cipher.setAAD(additionalData(areaId, kind));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(encoded, areaId, kind) {
  const [version, iv, tag, ciphertext] = String(encoded).split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error('Unrecognized secret format.');
  const decipher = createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(additionalData(areaId, kind));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

// Short-lived signed tokens for the server calling itself (a background sync
// starting its next stretch). Signed with a key derived from the same secret,
// so no extra setting is needed and a token cannot be forged from outside.
function tokenKey() {
  return createHmac('sha256', loadKey()).update('ogd-internal-token').digest();
}

export function signToken(payload, ttlMs) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', tokenKey()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

// Returns the payload, or null when the token is malformed, forged or expired.
export function verifyToken(token) {
  const [body, signature] = String(token ?? '').split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', tokenKey()).update(body).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

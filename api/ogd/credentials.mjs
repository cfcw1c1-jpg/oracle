import { authorize, HttpError, route } from '../_lib/access.mjs';
import { encryptSecret } from '../_lib/secrets.mjs';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// OGD's own login form caps both fields at 50 characters.
const LIMITS = { ogd: { identifier: 50, password: 50 }, gmail: { identifier: 254, password: 40 } };
// Google displays App Passwords in groups of four separated by spaces.
const APP_PASSWORD_PATTERN = /^[a-z0-9]{16}$/i;

export const POST = route(async (request) => {
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, scope, chapters } = await authorize(request, body.scope);
  const areaId = Number(body.areaId);
  if (!chapters.some((chapter) => chapter.areaId === areaId)) throw new HttpError(403, 'You cannot manage this chapter.');

  const kind = scope.credential;
  if (!kind) throw new HttpError(400, 'Unknown scope.');
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
  const rawPassword = typeof body.password === 'string' ? body.password : '';
  const password = kind === 'gmail' ? rawPassword.replace(/\s/g, '') : rawPassword;
  if (!identifier || !password) throw new HttpError(400, 'Both fields are required.');
  if (identifier.length > LIMITS[kind].identifier || rawPassword.length > LIMITS[kind].password) {
    throw new HttpError(400, 'One of the values is too long.');
  }
  if (kind === 'gmail' && !EMAIL_PATTERN.test(identifier)) throw new HttpError(400, 'Enter a valid email address.');
  if (kind === 'gmail' && !APP_PASSWORD_PATTERN.test(password)) {
    throw new HttpError(400, 'Enter the 16-character App Password from Google, not the normal Gmail password.');
  }

  const now = new Date().toISOString();
  const credentialColumns = kind === 'ogd'
    ? { ogd_username: identifier, ogd_password_enc: encryptSecret(password, areaId, 'ogd'), ogd_updated_at: now, ogd_updated_by: userId }
    : { gmail_address: identifier, gmail_password_enc: encryptSecret(password, areaId, 'gmail'), gmail_updated_at: now, gmail_updated_by: userId };

  // A previous result says nothing about credentials that just changed.
  const { error } = await db.from('ogd_chapter_connections').upsert(
    { area_id: areaId, ...credentialColumns, status: 'idle', failure_code: null, status_detail: null, updated_at: now },
    { onConflict: 'area_id' },
  );
  if (error) throw error;

  return { ok: true };
});

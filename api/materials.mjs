import { AwsClient } from 'aws4fetch';
import { createClient } from '@supabase/supabase-js';
import { HttpError, route } from './_lib/access.mjs';

// POST /api/materials: Materials files kept in Cloudflare R2 (bucket
// R2_BUCKET). The bucket is private; this hands out short-lived signed links
// after checking the caller the same way the database's RLS does:
//   { action: 'upload-url', folderId, fileName, contentType, size }  Admin
//       -> { url, key, provider: 'r2' }   the browser PUTs the file to url
//   { action: 'download-url', materialId, download }  Materials page access
//       -> { url }
//   { action: 'delete', materialIds: [...] }  Admin; removes the R2 objects
//       and their materials rows -> { deleted }
//   { action: 'discard', key }  Admin; removes an uploaded object whose
//       materials row could not be saved -> { ok }
// Answers 503 { code: 'r2_not_configured' } when the R2 variables are not
// set, so the page can keep using Supabase Storage.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://efelttlcyjfsvpxwmwjd.supabase.co';
// The publishable key is public (it ships in the web app); RLS does the guarding.
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_eBC1oFxCx_8m_TNNZX1ioQ_Lf_u6rpA';
const UPLOAD_TTL_SECONDS = 60 * 60;
const DOWNLOAD_TTL_SECONDS = 60 * 60;
// R2's limit for a single PUT.
const MAX_UPLOAD_BYTES = 5 * 1024 ** 3;

function r2() {
  const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
  const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
  const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
  const R2_BUCKET = process.env.R2_BUCKET;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  return {
    client: new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID.trim(), secretAccessKey: R2_SECRET_ACCESS_KEY.trim(), service: 's3', region: 'auto' }),
    base: `https://${R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com/${encodeURIComponent(R2_BUCKET.trim())}`,
  };
}

const objectUrl = (base, key) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function presign(storage, key, method, ttlSeconds, params = {}) {
  const url = new URL(objectUrl(storage.base, key));
  url.searchParams.set('X-Amz-Expires', String(ttlSeconds));
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const signed = await storage.client.sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}

// A Supabase client acting as the caller, so is_admin(), has_page_access()
// and the materials RLS policies apply to them.
async function callerClient(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Please sign in again.');
  const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Please sign in again.');
  return db;
}

async function requireAdmin(db) {
  const { data, error } = await db.rpc('is_admin');
  if (error) throw error;
  if (!data) throw new HttpError(403, 'Only Admins can change Materials.');
}

async function requireViewer(db) {
  const [{ data: admin, error: adminError }, { data: viewer, error: viewerError }] = await Promise.all([
    db.rpc('is_admin'),
    db.rpc('has_page_access', { p_page_key: 'materials' }),
  ]);
  if (adminError) throw adminError;
  if (viewerError) throw viewerError;
  if (!admin && !viewer) throw new HttpError(403, 'You do not have access to Materials.');
}

function safeName(name) {
  return String(name || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-120) || 'file';
}

// "Session 1 Handout.pdf" for Content-Disposition, with a UTF-8 fallback.
function disposition(fileName, download) {
  const ascii = String(fileName).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function uploadUrl(db, storage, body) {
  await requireAdmin(db);
  const folderId = String(body.folderId || '');
  const size = Number(body.size);
  if (!folderId) throw new HttpError(400, 'Choose a folder first.');
  if (!Number.isFinite(size) || size < 0) throw new HttpError(400, 'Unknown file size.');
  if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Files can be at most 5 GB.');
  const { data: folder, error } = await db.from('material_folders').select('id').eq('id', folderId).maybeSingle();
  if (error) throw error;
  if (!folder) throw new HttpError(404, 'That folder no longer exists.');
  const key = `materials/${folder.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName(body.fileName)}`;
  return { provider: 'r2', key, url: await presign(storage, key, 'PUT', UPLOAD_TTL_SECONDS) };
}

async function downloadUrl(db, storage, body) {
  await requireViewer(db);
  const { data: material, error } = await db
    .from('materials')
    .select('file_name, storage_path, storage_provider, mime_type')
    .eq('id', String(body.materialId || ''))
    .maybeSingle();
  if (error) throw error;
  if (!material || material.storage_provider !== 'r2') throw new HttpError(404, 'That file no longer exists.');
  const params = { 'response-content-disposition': disposition(material.file_name, Boolean(body.download)) };
  if (material.mime_type) params['response-content-type'] = material.mime_type;
  return { url: await presign(storage, material.storage_path, 'GET', DOWNLOAD_TTL_SECONDS, params) };
}

async function deleteFiles(db, storage, body) {
  await requireAdmin(db);
  const ids = (Array.isArray(body.materialIds) ? body.materialIds : []).map(String).filter(Boolean).slice(0, 1000);
  if (!ids.length) return { deleted: 0 };
  const { data: rows, error } = await db.from('materials').select('id, storage_path, storage_provider').in('id', ids);
  if (error) throw error;
  const r2Rows = rows.filter((row) => row.storage_provider === 'r2');
  for (const row of r2Rows) {
    const response = await storage.client.fetch(objectUrl(storage.base, row.storage_path), { method: 'DELETE' });
    // 404 means it is already gone, which is the goal.
    if (!response.ok && response.status !== 404) throw new Error(`R2 delete answered ${response.status}`);
  }
  if (r2Rows.length) {
    const { error: deleteError } = await db.from('materials').delete().in('id', r2Rows.map((row) => row.id));
    if (deleteError) throw deleteError;
  }
  return { deleted: r2Rows.length };
}

async function discard(db, storage, body) {
  await requireAdmin(db);
  const key = String(body.key || '');
  if (!/^materials\/[^/]+\/[^/]+$/.test(key)) throw new HttpError(400, 'Unknown file.');
  // Only objects no materials row points to; listed files go through delete.
  const { data: row, error } = await db.from('materials').select('id').eq('storage_path', key).maybeSingle();
  if (error) throw error;
  if (row) throw new HttpError(409, 'That file is listed in Materials; delete it there.');
  const response = await storage.client.fetch(objectUrl(storage.base, key), { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error(`R2 delete answered ${response.status}`);
  return { ok: true };
}

const ACTIONS = { 'upload-url': uploadUrl, 'download-url': downloadUrl, delete: deleteFiles, discard };

const handle = route(async (request, body) => {
  const action = ACTIONS[body.action];
  if (!action) throw new HttpError(400, 'Unknown action.');
  const db = await callerClient(request);
  const storage = r2();
  if (!storage) throw new HttpError(503, 'r2_not_configured');
  return action(db, storage, body);
});

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'Invalid request.' }, { status: 400 });
  return handle(request, body);
}

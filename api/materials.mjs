import { createClient } from '@supabase/supabase-js';
import { createAdminClient, HttpError, route } from './_lib/access.mjs';
import { shareInfo, shareLink } from './_lib/materialShare.mjs';
import { objectUrl, presign, presignDownload, r2 } from './_lib/r2.mjs';

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
//   { action: 'move-to-r2' }  Admin; moves the next few files still in
//       Supabase Storage into R2 -> { moved, failed, remaining }
// Public share links (no sign-in) are answered by _lib/materialShare.mjs:
//   GET ?share=TOKEN and { action: 'share-link', token, materialId, download }.
// Answers 503 { code: 'r2_not_configured' } when the R2 variables are not
// set, so the page can keep using Supabase Storage.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://efelttlcyjfsvpxwmwjd.supabase.co';
// The publishable key is public (it ships in the web app); RLS does the guarding.
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_eBC1oFxCx_8m_TNNZX1ioQ_Lf_u6rpA';
const UPLOAD_TTL_SECONDS = 60 * 60;
const DOWNLOAD_TTL_SECONDS = 60 * 60;
// R2's limit for a single PUT.
const MAX_UPLOAD_BYTES = 5 * 1024 ** 3;

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
  return { url: await presignDownload(storage, material, Boolean(body.download), DOWNLOAD_TTL_SECONDS) };
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

// Files moved per request, so each call ends well inside the function's
// time limit; the page calls again until none remain.
const MOVE_BATCH = 3;
const SUPABASE_BUCKET = 'materials';

// Copy to R2, point the row at the copy, then delete the Supabase copy. If a
// step fails the row still points at a file that exists.
async function moveToR2(db, storage) {
  await requireAdmin(db);
  const service = createAdminClient();
  const { data: rows, error } = await db
    .from('materials')
    .select('id, folder_id, file_name, storage_path, mime_type')
    .eq('storage_provider', 'supabase')
    .order('created_at')
    .limit(MOVE_BATCH);
  if (error) throw error;
  const moved = [];
  const failed = [];
  for (const row of rows) {
    try {
      const { data: blob, error: downloadError } = await service.storage.from(SUPABASE_BUCKET).download(row.storage_path);
      if (downloadError) throw new Error(`could not read it from Supabase (${downloadError.message})`);
      const key = `materials/${row.folder_id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName(row.file_name)}`;
      const body = new Uint8Array(await blob.arrayBuffer());
      const put = await storage.client.fetch(objectUrl(storage.base, key), {
        method: 'PUT',
        headers: { 'Content-Type': row.mime_type || 'application/octet-stream' },
        body,
      });
      if (!put.ok) throw new Error(`R2 refused the copy (${put.status})`);
      const { error: updateError } = await db
        .from('materials')
        .update({ storage_provider: 'r2', storage_path: key, size_bytes: body.byteLength })
        .eq('id', row.id)
        .eq('storage_provider', 'supabase');
      if (updateError) {
        await storage.client.fetch(objectUrl(storage.base, key), { method: 'DELETE' }).catch(() => null);
        throw new Error(`could not update its entry (${updateError.message})`);
      }
      // The row now points at R2; a leftover Supabase copy would only waste space.
      const { error: removeError } = await service.storage.from(SUPABASE_BUCKET).remove([row.storage_path]);
      if (removeError) console.error('[materials] old copy not removed:', row.storage_path, removeError.message);
      moved.push(row.file_name);
    } catch (moveError) {
      failed.push(`${row.file_name}: ${moveError.message}`);
    }
  }
  const { count, error: countError } = await db
    .from('materials')
    .select('id', { count: 'exact', head: true })
    .eq('storage_provider', 'supabase');
  if (countError) throw countError;
  return { moved, failed, remaining: count ?? 0 };
}

const ACTIONS = { 'upload-url': uploadUrl, 'download-url': downloadUrl, delete: deleteFiles, discard, 'move-to-r2': moveToR2 };

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
  // Public share links need no sign-in (see _lib/materialShare.mjs).
  if (body.action === 'share-link') return shareLink(body);
  return handle(request, body);
}

// GET /api/materials?share=TOKEN: what a public share link shows.
export async function GET(request) {
  return shareInfo(new URL(request.url).searchParams.get('share'));
}

import { createAdminClient } from './_lib/access.mjs';
import { presignDownload, r2 } from './_lib/r2.mjs';

// Public, time-limited Materials shares (no sign-in). The token comes from
// the share link / QR code an Admin made on the Materials page.
//   GET  /api/material-share?token=...
//        -> { title, kind, expiresAt, folders: [{ path, files: [...] }] }
//        410 { code: 'expired' } once the time limit passes; 404 when the
//        link is unknown or was revoked
//   POST /api/material-share { token, materialId, download }
//        -> { url }  a signed link that ends no later than the share does
// The token is checked on every request, so an expired link stops working
// at once, and no file link outlives its share.

const SUPABASE_BUCKET = 'materials';
const MAX_LINK_SECONDS = 60 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

async function findShare(db, token) {
  if (!TOKEN_PATTERN.test(token || '')) return { status: 404 };
  const { data: share, error } = await db
    .from('material_shares')
    .select('id, token, folder_id, material_id, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  if (!share || share.revoked_at) return { status: 404 };
  if (new Date(share.expires_at).getTime() <= Date.now()) return { status: 410, share };
  return { status: 200, share };
}

function refuse(found) {
  if (found.status === 410) {
    return json({ code: 'expired', expiresAt: found.share.expires_at, error: 'This share link has expired. Ask for a new QR code.' }, 410);
  }
  return json({ code: 'not_found', error: 'This share link is not valid or was turned off.' }, 404);
}

// The shared folder and every folder inside it, with their names as paths.
async function folderTree(db, rootId) {
  const { data, error } = await db.from('material_folders').select('id, name, parent_id');
  if (error) throw error;
  const byParent = new Map();
  for (const folder of data) byParent.set(folder.parent_id, [...(byParent.get(folder.parent_id) ?? []), folder]);
  const root = data.find((folder) => folder.id === rootId);
  if (!root) return [];
  const result = [{ id: root.id, path: [root.name] }];
  for (let index = 0; index < result.length; index += 1) {
    const children = (byParent.get(result[index].id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (!result.some((item) => item.id === child.id)) result.push({ id: child.id, path: [...result[index].path, child.name] });
    }
  }
  return result;
}

const FILE_COLUMNS = 'id, folder_id, file_name, mime_type, size_bytes, created_at';
const publicFile = (file) => ({ id: file.id, name: file.file_name, mimeType: file.mime_type, size: file.size_bytes, createdAt: file.created_at });

async function describe(db, share) {
  if (share.material_id) {
    const { data: file, error } = await db.from('materials').select(FILE_COLUMNS).eq('id', share.material_id).maybeSingle();
    if (error) throw error;
    if (!file) return null;
    return { title: file.file_name, kind: 'file', expiresAt: share.expires_at, folders: [{ path: [], files: [publicFile(file)] }] };
  }
  const tree = await folderTree(db, share.folder_id);
  if (!tree.length) return null;
  const { data: files, error } = await db.from('materials').select(FILE_COLUMNS).in('folder_id', tree.map((folder) => folder.id)).order('file_name');
  if (error) throw error;
  const folders = tree.map((folder) => ({
    // Paths are shown relative to the shared folder.
    path: folder.path.slice(1),
    files: files.filter((file) => file.folder_id === folder.id).map(publicFile),
  }));
  return { title: tree[0].path[0], kind: 'folder', expiresAt: share.expires_at, folders: folders.filter((folder) => folder.files.length || !folder.path.length) };
}

// True when the file is the shared one or sits in the shared folder tree.
async function inShare(db, share, file) {
  if (share.material_id) return file.id === share.material_id;
  const tree = await folderTree(db, share.folder_id);
  return tree.some((folder) => folder.id === file.folder_id);
}

export async function GET(request) {
  try {
    const db = createAdminClient();
    const token = new URL(request.url).searchParams.get('token');
    const found = await findShare(db, token);
    if (found.status !== 200) return refuse(found);
    const shared = await describe(db, found.share);
    if (!shared) return json({ code: 'not_found', error: 'The shared materials were removed.' }, 404);
    await db.rpc('count_material_share_view', { p_token: token }).then(() => null, () => null);
    return json(shared);
  } catch (error) {
    console.error('[material-share] failed:', error?.message);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'Invalid request.' }, 400);
    const db = createAdminClient();
    const found = await findShare(db, String(body.token || ''));
    if (found.status !== 200) return refuse(found);
    const { data: file, error } = await db
      .from('materials')
      .select('id, folder_id, file_name, storage_path, storage_provider, mime_type')
      .eq('id', String(body.materialId || ''))
      .maybeSingle();
    if (error) throw error;
    if (!file || !(await inShare(db, found.share, file))) return json({ error: 'That file is not part of this share.' }, 404);

    const secondsLeft = Math.floor((new Date(found.share.expires_at).getTime() - Date.now()) / 1000);
    const ttl = Math.max(1, Math.min(MAX_LINK_SECONDS, secondsLeft));
    const download = Boolean(body.download);
    if (file.storage_provider === 'r2') {
      const storage = r2();
      if (!storage) return json({ error: 'File storage is not available right now.' }, 503);
      return json({ url: await presignDownload(storage, file, download, ttl) });
    }
    const { data, error: signError } = await db.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(file.storage_path, ttl, download ? { download: file.file_name } : undefined);
    if (signError) throw signError;
    return json({ url: data.signedUrl });
  } catch (error) {
    console.error('[material-share] link failed:', error?.message);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

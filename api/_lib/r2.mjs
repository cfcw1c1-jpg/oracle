import { AwsClient } from 'aws4fetch';

// Cloudflare R2 (S3 API) for Materials files: the private bucket R2_BUCKET,
// reached with short-lived signed links. Returns null when the R2 variables
// are not set.
export function r2() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    client: new AwsClient({ accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim(), service: 's3', region: 'auto' }),
    base: `https://${accountId.trim()}.r2.cloudflarestorage.com/${encodeURIComponent(bucket.trim())}`,
  };
}

export const objectUrl = (base, key) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;

export async function presign(storage, key, method, ttlSeconds, params = {}) {
  const url = new URL(objectUrl(storage.base, key));
  url.searchParams.set('X-Amz-Expires', String(Math.max(1, Math.floor(ttlSeconds))));
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const signed = await storage.client.sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}

// "Session 1 Handout.pdf" for Content-Disposition, with a UTF-8 fallback.
export function disposition(fileName, download) {
  const ascii = String(fileName).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// A signed GET link that opens (or, with download, saves) the file under its name.
export function presignDownload(storage, material, download, ttlSeconds) {
  const params = { 'response-content-disposition': disposition(material.file_name, download) };
  if (material.mime_type) params['response-content-type'] = material.mime_type;
  return presign(storage, material.storage_path, 'GET', ttlSeconds, params);
}

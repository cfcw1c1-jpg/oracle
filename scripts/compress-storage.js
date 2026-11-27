#!/usr/bin/env node

// Shrinks files already in Supabase Storage with the same compression the web
// app now applies before every upload (web/src/lib/compress.js), run inside a
// headless Chrome so the results match the browser's exactly:
//   avatars          images, at most 512px
//   message-images   images, at most 1600px
//   materials        images at most 2000px, and the pictures inside
//                    PowerPoint/Word/Excel files
// Each file is overwritten at the same path (so every saved link still
// works), and only when the new copy is at least 10% smaller. Materials rows
// get their new size and type.
//
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/compress-storage.js           # dry run: report only
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/compress-storage.js --apply   # write the smaller copies
//
// Needs Google Chrome (CHROME_PATH, default /usr/bin/google-chrome).

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright-core');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://efelttlcyjfsvpxwmwjd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const APPLY = process.argv.includes('--apply');
const MIN_SAVING = 0.1;

const BUCKETS = [
  { name: 'avatars', preset: 'avatar' },
  { name: 'message-images', preset: 'message' },
  { name: 'materials', preset: 'material', office: true },
];
const OFFICE_EXTENSIONS = /\.(pptx|docx|xlsx|ppsx|potx|dotx|xltx)$/i;
const OFFICE_TYPE = 'application/vnd.openxmlformats-officedocument';

const ROOT = path.join(__dirname, '..');
const PAGE_ORIGIN = 'http://compress.local';
const PAGE_FILES = {
  '/index.html': { type: 'text/html', body: '<!doctype html><script type="importmap">{"imports":{"fflate":"/fflate.js"}}</script><script type="module">import { compressForUpload } from "/compress.js"; window.compressForUpload = compressForUpload; window.ready = true;</script>' },
  '/compress.js': { type: 'text/javascript', file: path.join(ROOT, 'web/src/lib/compress.js') },
  '/fflate.js': { type: 'text/javascript', file: path.join(ROOT, 'web/node_modules/fflate/esm/browser.js') },
};

// The real type from the first bytes; storage metadata is not always right.
function sniffType(bytes, name) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.slice(0, 4).toString() === 'RIFF' && bytes.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && OFFICE_EXTENSIONS.test(name)) return OFFICE_TYPE;
  return null;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

async function listAll(storage, prefix = '') {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const item of data) {
      const itemPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) files.push(...(await listAll(storage, itemPath)));
      else files.push({ path: itemPath, size: item.metadata?.size ?? 0 });
    }
    if (data.length < 1000) break;
  }
  return files;
}

async function openCompressor() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const page = await browser.newPage();
  await page.route(`${PAGE_ORIGIN}/**`, (route) => {
    const served = PAGE_FILES[new URL(route.request().url()).pathname];
    if (!served) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: served.type, body: served.body ?? fs.readFileSync(served.file) });
  });
  await page.goto(`${PAGE_ORIGIN}/index.html`);
  await page.waitForFunction(() => window.ready === true);
  const compress = async (bytes, name, type, preset) => {
    const result = await page.evaluate(async ({ base64, name, type, preset }) => {
      const raw = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const file = await window.compressForUpload(new File([raw], name, { type }), preset);
      const out = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let index = 0; index < out.length; index += 0x8000) binary += String.fromCharCode(...out.subarray(index, index + 0x8000));
      return { base64: btoa(binary), type: file.type, name: file.name };
    }, { base64: bytes.toString('base64'), name, type, preset });
    return { bytes: Buffer.from(result.base64, 'base64'), type: result.type, name: result.name };
  };
  return { compress, close: () => browser.close() };
}

async function main() {
  if (!SERVICE_ROLE_KEY) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY.');
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const compressor = await openCompressor();
  console.log(APPLY ? 'Writing smaller copies.\n' : 'Dry run: nothing is changed. Add --apply to write the smaller copies.\n');
  let before = 0;
  let after = 0;
  try {
    for (const bucket of BUCKETS) {
      const storage = db.storage.from(bucket.name);
      const files = await listAll(storage);
      console.log(`${bucket.name}: ${files.length} files`);
      for (const file of files) {
        const name = path.basename(file.path);
        const { data, error } = await storage.download(file.path);
        if (error) {
          console.log(`  ! ${file.path}: ${error.message}`);
          continue;
        }
        const bytes = Buffer.from(await data.arrayBuffer());
        const type = sniffType(bytes, name);
        const isOffice = type === OFFICE_TYPE;
        if (!type || (isOffice && !bucket.office) || type === 'image/webp') continue;
        const result = await compressor.compress(bytes, name, isOffice ? data.type || OFFICE_TYPE : type, bucket.preset).catch((err) => {
          console.log(`  ! ${file.path}: ${err.message.split('\n')[0]}`);
          return null;
        });
        if (!result || result.bytes.length > bytes.length * (1 - MIN_SAVING)) continue;
        before += bytes.length;
        after += result.bytes.length;
        console.log(`  ${file.path}: ${kb(bytes.length)} -> ${kb(result.bytes.length)} (${result.type})`);
        if (!APPLY) continue;
        const contentType = isOffice ? data.type || OFFICE_TYPE : result.type;
        const { error: uploadError } = await storage.upload(file.path, result.bytes, { contentType, upsert: true });
        if (uploadError) {
          console.log(`    ! not saved: ${uploadError.message}`);
          continue;
        }
        if (bucket.name === 'materials') {
          // An image saved as WebP/JPEG also gets that extension in its name,
          // so a download opens with the right program.
          const { data: row } = await db.from('materials').select('file_name').eq('storage_path', file.path).maybeSingle();
          const extension = { 'image/webp': 'webp', 'image/jpeg': 'jpg' }[contentType];
          const fileName = row && extension && type !== contentType ? row.file_name.replace(/(\.[^.]+)?$/, `.${extension}`) : row?.file_name;
          const { error: rowError } = await db.from('materials').update({ size_bytes: result.bytes.length, mime_type: contentType, ...(fileName ? { file_name: fileName } : {}) }).eq('storage_path', file.path);
          if (rowError) console.log(`    ! materials row not updated: ${rowError.message}`);
        }
      }
    }
  } finally {
    await compressor.close();
  }
  console.log(`\n${APPLY ? 'Saved' : 'Would save'} ${kb(before - after)} (${kb(before)} -> ${kb(after)}).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

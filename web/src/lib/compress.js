// Shrinks files in the browser before they are uploaded, so storage holds
// smaller copies:
//   photos and images      resized to a maximum size and saved as WebP (JPEG
//                          where the browser cannot write WebP)
//   PowerPoint/Word/Excel  the pictures inside are shrunk the same way and the
//                          file is zipped again at maximum compression
// Anything else (PDF, video, audio, archives) is uploaded as it is. A
// compressed copy is only used when it is actually smaller, and a file that
// cannot be read is uploaded unchanged, so compression never blocks an upload.

const IMAGE_TYPES = /^image\/(jpeg|png|webp|bmp)$/i;
const OFFICE_EXTENSIONS = /\.(pptx|docx|xlsx|ppsx|potx|dotx|xltx)$/i;
// Pictures embedded in an Office file live under these folders.
const OFFICE_MEDIA = /^(ppt|word|xl)\/media\/[^/]+\.(jpe?g|png)$/i;

export const IMAGE_PRESETS = {
  avatar: { maxSize: 512, quality: 0.82 },
  message: { maxSize: 1600, quality: 0.8 },
  material: { maxSize: 2000, quality: 0.82 },
};

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The image could not be read.'));
    };
    image.src = url;
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// Draws the image at most maxSize on its longer side. Returns the canvas.
function drawScaled(image, maxSize, background) {
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Resizes and re-encodes one image. keepType keeps JPEG as JPEG and PNG as
// PNG (needed inside Office files, which refer to pictures by file name).
// Resolves to a Blob, or null when the result would not be smaller.
export async function shrinkImage(blob, { maxSize, quality }, { keepType = null } = {}) {
  const image = await loadImage(blob);
  let result;
  if (keepType === 'image/png') {
    // PNG is lossless, so only resizing helps; skip pictures already small enough.
    if (Math.max(image.naturalWidth, image.naturalHeight) <= maxSize) return null;
    result = await canvasBlob(drawScaled(image, maxSize), 'image/png');
  } else if (keepType === 'image/jpeg') {
    result = await canvasBlob(drawScaled(image, maxSize, '#ffffff'), 'image/jpeg', quality);
  } else {
    result = await canvasBlob(drawScaled(image, maxSize), 'image/webp', quality);
    // Browsers that cannot write WebP hand back PNG; use JPEG there instead.
    if (!result || result.type !== 'image/webp') result = await canvasBlob(drawScaled(image, maxSize, '#ffffff'), 'image/jpeg', quality);
  }
  return result && result.size < blob.size ? result : null;
}

function renamed(name, type) {
  const extension = type === 'image/webp' ? 'webp' : type === 'image/jpeg' ? 'jpg' : null;
  if (!extension) return name;
  return /\.[^.]+$/.test(name) ? name.replace(/\.[^.]+$/, `.${extension}`) : `${name}.${extension}`;
}

async function compressImageFile(file, preset) {
  const smaller = await shrinkImage(file, preset);
  return smaller ? new File([smaller], renamed(file.name, smaller.type), { type: smaller.type, lastModified: file.lastModified }) : file;
}

async function compressOfficeFile(file, preset) {
  const { unzipSync, zipSync } = await import('fflate');
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  for (const [path, bytes] of Object.entries(entries)) {
    if (!OFFICE_MEDIA.test(path)) continue;
    const keepType = /\.png$/i.test(path) ? 'image/png' : 'image/jpeg';
    const smaller = await shrinkImage(new Blob([bytes], { type: keepType }), preset, { keepType }).catch(() => null);
    if (smaller) entries[path] = new Uint8Array(await smaller.arrayBuffer());
  }
  // Office reads [Content_Types].xml first, so it stays the first entry.
  const zipped = zipSync(entries, { level: 9 });
  return zipped.byteLength < file.size ? new File([zipped], file.name, { type: file.type, lastModified: file.lastModified }) : file;
}

// The file to upload in place of `file`: a smaller copy when one can be made,
// otherwise the file itself. preset: a key of IMAGE_PRESETS.
export async function compressForUpload(file, preset = 'material') {
  const settings = IMAGE_PRESETS[preset] ?? IMAGE_PRESETS.material;
  try {
    if (IMAGE_TYPES.test(file.type)) return await compressImageFile(file, settings);
    if (OFFICE_EXTENSIONS.test(file.name)) return await compressOfficeFile(file, settings);
  } catch (error) {
    console.warn('[compress] uploading the original:', error?.message);
  }
  return file;
}

import { encode } from 'uqr';

// QR codes for share links, drawn from the encoded module grid so they stay
// crisp at any size. Error correction "M" survives a little smudging on print.

export function qrSvg(text, { border = 2 } = {}) {
  const { data, size } = encode(text, { ecc: 'M', border });
  let path = '';
  data.forEach((row, y) => row.forEach((on, x) => {
    if (on) path += `M${x} ${y}h1v1h-1z`;
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

// A PNG of the code with a caption under it, for printing or sending.
export function qrPng(text, caption = '', pixels = 1024) {
  const { data, size } = encode(text, { ecc: 'M', border: 3 });
  const cell = Math.floor(pixels / size);
  const side = cell * size;
  const captionHeight = caption ? Math.round(side * 0.12) : 0;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side + captionHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  data.forEach((row, y) => row.forEach((on, x) => {
    if (on) ctx.fillRect(x * cell, y * cell, cell, cell);
  }));
  if (caption) {
    ctx.font = `600 ${Math.round(captionHeight * 0.36)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let text = caption;
    while (text.length > 4 && ctx.measureText(text).width > side * 0.92) text = `${text.slice(0, -2)}…`;
    ctx.fillText(text, side / 2, side + captionHeight / 2 - cell);
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

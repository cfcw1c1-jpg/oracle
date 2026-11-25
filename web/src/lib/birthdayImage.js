// Draws birthday greeting images (1080 × 1350, portrait for social posts) with
// only each celebrant's date, name and role. Long lists are split across
// several images. Everything is drawn on a canvas in the browser.

const WIDTH = 1080;
const HEIGHT = 1350;
const FONT = '"DM Sans Variable", "DM Sans", system-ui, sans-serif';
const SHORT_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const COLORS = {
  bgTop: '#0b1f4d',
  bgBottom: '#22407f',
  gold: '#f2c46d',
  goldDeep: '#d9a441',
  panel: '#ffffff',
  ink: '#14213d',
  muted: '#6b7280',
  rule: '#eef0f4',
  confetti: ['#f2c46d', '#ff8fab', '#7ad3c8', '#ffffff', '#b8a4ff'],
};

// One column up to this many rows; two columns after that.
const SINGLE_COLUMN_MAX = 10;
const ROWS_PER_COLUMN = 12;
const PER_PAGE = ROWS_PER_COLUMN * 2;

// Fixed sequence so the same list always draws the same confetti.
function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) trimmed = trimmed.slice(0, -1);
  return `${trimmed.trimEnd()}…`;
}

function setSpacing(ctx, value) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = value;
}

function drawBalloon(ctx, x, y, radius, color, tilt) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, radius * 1.2);
  ctx.bezierCurveTo(-14, radius * 1.8, 14, radius * 2.3, -6, radius * 3.1);
  ctx.stroke();
  const gradient = ctx.createRadialGradient(-radius * 0.35, -radius * 0.4, radius * 0.1, 0, 0, radius * 1.2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.75)');
  gradient.addColorStop(0.25, color);
  gradient.addColorStop(1, color);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-7, radius * 1.18);
  ctx.lineTo(7, radius * 1.18);
  ctx.lineTo(0, radius * 1.32);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBackground(ctx, seed) {
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, COLORS.bgTop);
  gradient.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(WIDTH / 2, 230, 20, WIDTH / 2, 230, 520);
  glow.addColorStop(0, 'rgba(242,196,109,0.22)');
  glow.addColorStop(1, 'rgba(242,196,109,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const random = seededRandom(seed);
  for (let index = 0; index < 90; index += 1) {
    const x = random() * WIDTH;
    const y = random() * HEIGHT;
    // Keep confetti around the edges and title, not over the list.
    if (y > 360 && x > 50 && x < WIDTH - 50) continue;
    if (y > 100 && y < 345 && x > 150 && x < WIDTH - 150) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(random() * Math.PI);
    ctx.globalAlpha = 0.55 + random() * 0.45;
    ctx.fillStyle = COLORS.confetti[Math.floor(random() * COLORS.confetti.length)];
    if (random() > 0.5) ctx.fillRect(-7, -3, 14, 6);
    else {
      ctx.beginPath();
      ctx.arc(0, 0, 3 + random() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Kept in the corners, clear of the title.
  drawBalloon(ctx, 70, 120, 40, '#ff8fab', -0.16);
  drawBalloon(ctx, 138, 78, 32, COLORS.gold, 0.06);
  drawBalloon(ctx, WIDTH - 70, 115, 40, '#7ad3c8', 0.16);
  drawBalloon(ctx, WIDTH - 138, 75, 32, '#b8a4ff', -0.06);
}

function drawHeader(ctx, subtitle) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.gold;
  ctx.font = `600 26px ${FONT}`;
  setSpacing(ctx, '8px');
  ctx.fillText('CELEBRATING YOU', WIDTH / 2, 150);
  setSpacing(ctx, '0px');

  ctx.fillStyle = '#ffffff';
  ctx.font = `800 92px ${FONT}`;
  ctx.fillText('Happy Birthday!', WIDTH / 2, 268);

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText(fitText(ctx, subtitle, WIDTH - 160), WIDTH / 2, 326);
}

function drawDateBadge(ctx, x, y, size, celebrant) {
  roundRect(ctx, x, y, size, size, size * 0.24);
  const gradient = ctx.createLinearGradient(x, y, x, y + size);
  gradient.addColorStop(0, COLORS.gold);
  gradient.addColorStop(1, COLORS.goldDeep);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.ink;
  ctx.font = `700 ${Math.round(size * 0.2)}px ${FONT}`;
  setSpacing(ctx, '2px');
  ctx.fillText(SHORT_MONTHS[celebrant.month - 1], x + size / 2, y + size * 0.36);
  setSpacing(ctx, '0px');
  ctx.font = `800 ${Math.round(size * 0.42)}px ${FONT}`;
  ctx.fillText(String(celebrant.day).padStart(2, '0'), x + size / 2, y + size * 0.82);
}

function rowLayout(count) {
  const twoColumns = count > SINGLE_COLUMN_MAX;
  const perColumn = twoColumns ? ROWS_PER_COLUMN : SINGLE_COLUMN_MAX;
  return { twoColumns, perColumn, rowHeight: twoColumns ? 63 : 76, usedRows: Math.min(count, perColumn) };
}

function drawRows(ctx, celebrants, area) {
  const { twoColumns, perColumn, rowHeight } = rowLayout(celebrants.length);
  const columns = twoColumns ? 2 : 1;
  const badge = twoColumns ? 54 : 64;
  const nameSize = twoColumns ? 24 : 32;
  const roleSize = twoColumns ? 18 : 22;
  const gap = 28;
  const columnWidth = (area.width - gap * (columns - 1)) / columns;
  const usedRows = Math.min(celebrants.length, perColumn);
  const top = area.y + (area.height - usedRows * rowHeight) / 2;

  celebrants.forEach((celebrant, index) => {
    const column = Math.floor(index / perColumn);
    const row = index % perColumn;
    const x = area.x + column * (columnWidth + gap);
    const y = top + row * rowHeight;
    const badgeY = y + (rowHeight - badge) / 2;
    drawDateBadge(ctx, x, badgeY, badge, celebrant);

    const textX = x + badge + 20;
    const textWidth = columnWidth - badge - 24;
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 ${nameSize}px ${FONT}`;
    ctx.fillText(fitText(ctx, celebrant.name, textWidth), textX, badgeY + badge * 0.48);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 ${roleSize}px ${FONT}`;
    ctx.fillText(fitText(ctx, celebrant.role, textWidth), textX, badgeY + badge * 0.9);

    if (row < usedRows - 1) {
      ctx.fillStyle = COLORS.rule;
      ctx.fillRect(textX, y + rowHeight - 1, textWidth, 1);
    }
  });
}

function drawFooter(ctx, pageIndex, pageCount) {
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(fitText(ctx, 'May God bless you with joy, good health and a wonderful year ahead!', WIDTH - 100), WIDTH / 2, HEIGHT - 78);
  if (pageCount > 1) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `500 20px ${FONT}`;
    ctx.fillText(`${pageIndex + 1} of ${pageCount}`, WIDTH / 2, HEIGHT - 38);
  }
}

// celebrants: [{ month (1-12), day, name, role }] already in the order to show.
// Returns one PNG data URL and Blob per image.
export async function renderBirthdayImages(celebrants, subtitle) {
  if (document.fonts?.load) {
    await Promise.all(['500', '600', '700', '800'].map((weight) => document.fonts.load(`${weight} 32px "DM Sans Variable"`)));
  }
  const pages = [];
  for (let start = 0; start < celebrants.length; start += PER_PAGE) pages.push(celebrants.slice(start, start + PER_PAGE));

  return Promise.all(pages.map(async (page, pageIndex) => {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    drawBackground(ctx, 7 + pageIndex * 101);
    drawHeader(ctx, subtitle);

    // The panel fits its rows and sits a little below the title.
    const { rowHeight, usedRows } = rowLayout(page.length);
    const panelHeight = Math.max(usedRows * rowHeight + 60, 260);
    const space = { top: 380, bottom: HEIGHT - 150 };
    const panel = { x: 60, y: space.top + Math.max(0, (space.bottom - space.top - panelHeight) * 0.3), width: WIDTH - 120, height: panelHeight };
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 16;
    roundRect(ctx, panel.x, panel.y, panel.width, panel.height, 36);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    ctx.restore();

    drawRows(ctx, page, { x: panel.x + 44, y: panel.y + 30, width: panel.width - 88, height: panel.height - 60 });
    drawFooter(ctx, pageIndex, pages.length);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return { url: canvas.toDataURL('image/png'), blob };
  }));
}

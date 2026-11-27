// Draws greeting images (1600 × 1000, wide landscape) for birthdays and
// wedding anniversaries, with only each celebrant's date, name and one line
// under it (role, or years married). Long lists are split across several
// images. Everything is drawn on a canvas in the browser.

const WIDTH = 1600;
const HEIGHT = 1000;
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

// One column up to 6, two columns of 6 up to 12, then three columns of 7.
const ROWS_SHORT = 6;
const ROWS_TALL = 7;
const PER_PAGE = ROWS_TALL * 3;

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

  const glow = ctx.createRadialGradient(WIDTH / 2, 190, 20, WIDTH / 2, 190, 620);
  glow.addColorStop(0, 'rgba(242,196,109,0.22)');
  glow.addColorStop(1, 'rgba(242,196,109,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const random = seededRandom(seed);
  for (let index = 0; index < 90; index += 1) {
    const x = random() * WIDTH;
    const y = random() * HEIGHT;
    // Keep confetti around the edges and title, not over the list.
    if (y > 300 && x > 50 && x < WIDTH - 50) continue;
    if (y > 80 && y < 295 && x > 300 && x < WIDTH - 300) continue;
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
  drawBalloon(ctx, 90, 110, 40, '#ff8fab', -0.16);
  drawBalloon(ctx, 165, 70, 32, COLORS.gold, 0.06);
  drawBalloon(ctx, 235, 120, 28, '#7ad3c8', 0.1);
  drawBalloon(ctx, WIDTH - 90, 105, 40, '#7ad3c8', 0.16);
  drawBalloon(ctx, WIDTH - 165, 68, 32, '#b8a4ff', -0.06);
  drawBalloon(ctx, WIDTH - 235, 118, 28, '#ff8fab', -0.1);
}

const GREETINGS = {
  birthday: {
    kicker: 'CELEBRATING YOU',
    title: 'Happy Birthday!',
    footer: 'May God bless you with joy, good health and a wonderful year ahead!',
  },
  anniversary: {
    kicker: 'CELEBRATING LOVE',
    title: 'Happy Anniversary!',
    footer: 'May God keep blessing your marriage with love, joy and faithfulness!',
  },
};

function drawHeader(ctx, subtitle, greeting) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.gold;
  ctx.font = `600 26px ${FONT}`;
  setSpacing(ctx, '8px');
  ctx.fillText(greeting.kicker, WIDTH / 2, 112);
  setSpacing(ctx, '0px');

  ctx.fillStyle = '#ffffff';
  ctx.font = `800 88px ${FONT}`;
  ctx.fillText(greeting.title, WIDTH / 2, 210);

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText(fitText(ctx, subtitle, WIDTH - 600), WIDTH / 2, 264);
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

// Column count, sizes and widths for a page of `count` rows. `wrapped` makes
// the rows taller so a name set on two lines still fits beside its badge.
function rowLayout(count, wrapped = false) {
  let columns = 1;
  if (count > ROWS_SHORT * 2) columns = 3;
  else if (count > ROWS_SHORT) columns = 2;
  const perColumn = columns === 3 ? ROWS_TALL : ROWS_SHORT;
  const badge = columns === 3 ? 54 : 64;
  // A single column is kept narrower so the names don't sit far from the dates.
  const panelWidth = columns === 1 ? 900 : WIDTH - 120;
  const gap = 40;
  const columnWidth = (panelWidth - 88 - gap * (columns - 1)) / columns;
  let rowHeight = columns === 3 ? 64 : 76;
  if (wrapped) rowHeight = columns === 3 ? 74 : 84;
  return {
    columns, perColumn, badge, gap, panelWidth, columnWidth, rowHeight,
    textWidth: columnWidth - badge - 24,
    nameSize: columns === 3 ? 25 : 30,
    roleSize: columns === 3 ? 18 : 21,
    usedRows: Math.min(count, perColumn),
  };
}

const fits = (ctx, text, width, font) => {
  ctx.font = font;
  return ctx.measureText(text).width <= width;
};

// Sets a name in full: on one line, a little smaller if needed, or else on
// two lines (split after "&" when it can, otherwise at the most even word
// break). Only a name too long even for two small lines is shortened.
function setName(ctx, name, width, size) {
  const font = (px) => `700 ${px}px ${FONT}`;
  for (let px = size; px >= Math.round(size * 0.85); px -= 1) {
    if (fits(ctx, name, width, font(px))) return { lines: [name], size: px };
  }
  const words = name.split(/\s+/);
  const splits = [];
  for (let index = 1; index < words.length; index += 1) {
    splits.push({ lines: [words.slice(0, index).join(' '), words.slice(index).join(' ')], atAnd: words[index - 1] === '&' });
  }
  const largest = (lines) => {
    for (let px = Math.round(size * 0.85); px >= Math.round(size * 0.6); px -= 1) {
      if (lines.every((line) => fits(ctx, line, width, font(px)))) return px;
    }
    return 0;
  };
  let best = null;
  for (const split of splits) {
    const px = largest(split.lines);
    // A split after "&" wins unless another is clearly larger.
    const score = px + (split.atAnd ? 2 : 0);
    if (px && (!best || score > best.score)) best = { lines: split.lines, size: px, score };
  }
  if (best) return { lines: best.lines, size: best.size };
  const px = Math.round(size * 0.6);
  ctx.font = font(px);
  const fallback = splits.length ? splits[Math.floor(splits.length / 2)].lines : [name];
  return { lines: fallback.map((line) => fitText(ctx, line, width)), size: px };
}

function setRole(ctx, role, width, size) {
  const font = (px) => `500 ${px}px ${FONT}`;
  for (let px = size; px >= Math.round(size * 0.85); px -= 1) {
    if (fits(ctx, role, width, font(px))) return { text: role, size: px };
  }
  const px = Math.round(size * 0.85);
  ctx.font = font(px);
  return { text: fitText(ctx, role, width), size: px };
}

// Sets every row's name and role, then picks the page layout.
function prepareRows(ctx, celebrants) {
  const base = rowLayout(celebrants.length);
  const rows = celebrants.map((celebrant) => ({
    celebrant,
    name: setName(ctx, celebrant.name ?? '', base.textWidth, base.nameSize),
    role: setRole(ctx, celebrant.role ?? '', base.textWidth, base.roleSize),
  }));
  const wrapped = rows.some((row) => row.name.lines.length > 1);
  return { rows, layout: wrapped ? rowLayout(celebrants.length, true) : base };
}

function drawRows(ctx, rows, layout, area) {
  const { perColumn, rowHeight, badge, gap, columnWidth, textWidth, usedRows } = layout;
  const top = area.y + (area.height - usedRows * rowHeight) / 2;

  rows.forEach(({ celebrant, name, role }, index) => {
    const column = Math.floor(index / perColumn);
    const row = index % perColumn;
    const x = area.x + column * (columnWidth + gap);
    const y = top + row * rowHeight;
    const badgeY = y + (rowHeight - badge) / 2;
    drawDateBadge(ctx, x, badgeY, badge, celebrant);

    const textX = x + badge + 20;
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 ${name.size}px ${FONT}`;
    if (name.lines.length === 1) {
      ctx.fillText(name.lines[0], textX, badgeY + badge * 0.48);
      ctx.fillStyle = COLORS.muted;
      ctx.font = `500 ${role.size}px ${FONT}`;
      ctx.fillText(role.text, textX, badgeY + badge * 0.9);
    } else {
      // Two name lines and the role, centred on the row.
      const lineStep = name.size * 1.1;
      const block = name.size + lineStep + role.size * 1.3;
      const first = y + (rowHeight - block) / 2 + name.size * 0.9;
      name.lines.forEach((line, lineIndex) => ctx.fillText(line, textX, first + lineIndex * lineStep));
      ctx.fillStyle = COLORS.muted;
      ctx.font = `500 ${role.size}px ${FONT}`;
      ctx.fillText(role.text, textX, first + lineStep + role.size * 1.3);
    }

    if (row < usedRows - 1) {
      ctx.fillStyle = COLORS.rule;
      ctx.fillRect(textX, y + rowHeight - 1, textWidth, 1);
    }
  });
}

function drawFooter(ctx, pageIndex, pageCount, greeting) {
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(fitText(ctx, greeting.footer, WIDTH - 100), WIDTH / 2, HEIGHT - 62);
  if (pageCount > 1) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `500 20px ${FONT}`;
    ctx.fillText(`${pageIndex + 1} of ${pageCount}`, WIDTH / 2, HEIGHT - 26);
  }
}

// celebrants: [{ month (1-12), day, name, role }] already in the order to show.
// kind: 'birthday' or 'anniversary'. Returns one PNG data URL and Blob per image.
export async function renderGreetingImages(celebrants, subtitle, kind = 'birthday') {
  const greeting = GREETINGS[kind] ?? GREETINGS.birthday;
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
    drawHeader(ctx, subtitle, greeting);

    // The panel fits its rows and sits a little below the title.
    const { rows, layout } = prepareRows(ctx, page);
    const { rowHeight, usedRows, panelWidth } = layout;
    const panelHeight = Math.max(usedRows * rowHeight + 60, 240);
    const space = { top: 310, bottom: HEIGHT - 110 };
    const panel = { x: (WIDTH - panelWidth) / 2, y: space.top + Math.max(0, (space.bottom - space.top - panelHeight) * 0.3), width: panelWidth, height: panelHeight };
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 16;
    roundRect(ctx, panel.x, panel.y, panel.width, panel.height, 36);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    ctx.restore();

    drawRows(ctx, rows, layout, { x: panel.x + 44, y: panel.y + 30, width: panel.width - 88, height: panel.height - 60 });
    drawFooter(ctx, pageIndex, pages.length, greeting);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return { url: canvas.toDataURL('image/png'), blob };
  }));
}

export const renderBirthdayImages = (celebrants, subtitle) => renderGreetingImages(celebrants, subtitle, 'birthday');
export const renderAnniversaryImages = (couples, subtitle) => renderGreetingImages(couples, subtitle, 'anniversary');

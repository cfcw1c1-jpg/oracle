// Gospel of the Day in Tagalog: Evangelizo gives the day's liturgical name and
// Gospel reference; the text comes from the Magandang Balita Biblia (MBBTAG)
// on Bible Gateway.

const EVANGELIZO = 'https://feed.evangelizo.org/v2/reader.php';
const BIBLE_GATEWAY = 'https://www.biblegateway.com/passage/';
const VERSION = 'MBBTAG';
const TIMEOUT_MS = 8000;

export const ATTRIBUTION = 'Magandang Balita Biblia, Copyright © Philippine Bible Society 2012.';
export const SOURCE_URL = 'https://www.biblegateway.com/versions/Magandang-Balita-Biblia-MBBTAG/';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#039': "'" };
export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z#0-9]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

const stripTags = (html) => decodeEntities(String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));

// "Matt <font dir="ltr">25,31-46.</font>" -> "Matt 25:31-46"
// "John 20,1-2.11-18." -> "John 20:1-2,11-18"
export function toSearchReference(evangelizoReference) {
  const text = stripTags(evangelizoReference).replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const match = /^((?:[1-3]\s?)?[A-Za-z]+)\.?\s+(\d+),(.+)$/.exec(text);
  if (!match) return text || null;
  const [, book, chapter, verses] = match;
  return `${book} ${chapter}:${verses.replace(/\./g, ',').replace(/\s+/g, '')}`;
}

// Reads the passage out of a Bible Gateway page: the Tagalog reference (from
// the page title) and the verses as paragraphs, without headings, verse
// numbers, cross-references or footnotes.
export function parsePassage(html) {
  const title = /<meta property="og:title" content="Bible Gateway passage: (.*?) - [^"]*"/.exec(html);
  const start = html.indexOf('<div class="passage-text">');
  if (start === -1) return null;
  const endMarkers = ['<div class="footnotes"', '<div class="crossrefs', '<div class="full-chap-link"', '<a class="full-chap-link"', 'Read full chapter'];
  const end = Math.min(...endMarkers.map((marker) => html.indexOf(marker, start)).filter((index) => index !== -1), html.length);
  const body = html.slice(start, end)
    .replace(/<(h[1-6])\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<span class="chapternum">[\s\S]*?<\/span>/gi, '');
  const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!paragraphs.length) return null;
  return { reference: title ? decodeEntities(title[1]).trim() : null, text: paragraphs.join('\n\n') };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; OracleGospel/1.0)', accept: 'text/html,*/*' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.text();
}

const evangelizo = (dateText, type, content) => {
  const params = new URLSearchParams({ date: dateText, type, lang: 'AM' });
  if (content) params.set('content', content);
  return fetchText(`${EVANGELIZO}?${params}`);
};

export async function gospelOfTheDay(dateText) {
  const [liturgic, reference] = await Promise.all([evangelizo(dateText, 'liturgic_t'), evangelizo(dateText, 'reading_st', 'GSP')]);
  if (/wrong param/i.test(liturgic) || /wrong param/i.test(reference)) throw new Error('Evangelizo has no reading for that date.');
  const search = toSearchReference(reference);
  if (!search) throw new Error('Evangelizo gave no Gospel reference for that date.');

  const page = await fetchText(`${BIBLE_GATEWAY}?${new URLSearchParams({ search, version: VERSION })}`);
  const passage = parsePassage(page);
  if (!passage) throw new Error(`Bible Gateway showed no ${VERSION} text for ${search}.`);
  return {
    liturgicalDay: stripTags(liturgic).trim(),
    citation: passage.reference || search,
    text: passage.text,
    attribution: ATTRIBUTION,
    sourceUrl: SOURCE_URL,
  };
}

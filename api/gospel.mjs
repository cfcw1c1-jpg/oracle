import { gospelOfTheDay } from './_lib/gospel.mjs';

// GET /api/gospel?date=YYYYMMDD -> today's Gospel in Tagalog (MBBTAG).
// Public scripture, no sign-in. Vercel's CDN keeps each date's answer for six
// hours, so Bible Gateway and Evangelizo see a handful of requests a day.
const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()).replace(/-/g, '');

export async function GET(request) {
  const date = new URL(request.url).searchParams.get('date') || manilaToday();
  if (!/^\d{8}$/.test(date)) return Response.json({ error: 'date must be YYYYMMDD.' }, { status: 400 });
  try {
    const gospel = await gospelOfTheDay(date);
    return Response.json(gospel, { headers: { 'cache-control': 'public, max-age=900, s-maxage=21600, stale-while-revalidate=86400' } });
  } catch (error) {
    console.error('[gospel] failed:', error?.message);
    return Response.json({ error: "Unable to load today's Gospel reading." }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}

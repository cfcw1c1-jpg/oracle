import { OGD_LOGIN_URL } from './ogdLogin.mjs';

// Keeps a saved OGD session from timing out while Oracle is open, using a
// plain request with the saved cookies instead of a browser. OGD then still
// accepts the session at the next sync, so no login or OTP is needed.

const HOME_URL = new URL('/default.aspx', OGD_LOGIN_URL).href;
const REQUEST_TIMEOUT_MS = 15000;
const FALLBACK_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function domainMatches(cookieDomain, host) {
  const domain = String(cookieDomain || '').replace(/^\./, '').toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

// The Cookie header a browser would send to url from these saved cookies.
export function cookieHeader(cookies, url, nowSeconds = Date.now() / 1000) {
  const { hostname, pathname, protocol } = new URL(url);
  return (cookies ?? [])
    .filter((cookie) => domainMatches(cookie.domain, hostname.toLowerCase()))
    .filter((cookie) => pathname.startsWith(cookie.path || '/'))
    .filter((cookie) => !(cookie.secure && protocol !== 'https:'))
    .filter((cookie) => !(cookie.expires > 0 && cookie.expires < nowSeconds))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

// Folds Set-Cookie headers into the saved cookies, the way a browser would.
export function applySetCookies(cookies, setCookieHeaders, url, nowSeconds = Date.now() / 1000) {
  const { hostname } = new URL(url);
  const next = [...(cookies ?? [])];
  for (const header of setCookieHeaders ?? []) {
    const [pair, ...attributeParts] = header.split(';');
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const attributes = Object.fromEntries(attributeParts.map((part) => {
      const index = part.indexOf('=');
      return index === -1 ? [part.trim().toLowerCase(), true] : [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()];
    }));
    const domain = typeof attributes.domain === 'string' ? `.${attributes.domain.replace(/^\./, '')}` : hostname;
    const path = typeof attributes.path === 'string' ? attributes.path : '/';
    let expires = -1;
    if (attributes['max-age'] !== undefined) expires = nowSeconds + Number(attributes['max-age']);
    else if (typeof attributes.expires === 'string' && !Number.isNaN(Date.parse(attributes.expires))) expires = Date.parse(attributes.expires) / 1000;

    const index = next.findIndex((cookie) => cookie.name === name && cookie.path === path && cookie.domain.replace(/^\./, '') === domain.replace(/^\./, ''));
    const isRemoval = expires !== -1 && expires < nowSeconds;
    if (isRemoval) {
      if (index !== -1) next.splice(index, 1);
      continue;
    }
    const cookie = {
      ...(index === -1 ? { sameSite: 'Lax' } : next[index]),
      name, value, domain, path, expires,
      httpOnly: Boolean(attributes.httponly),
      secure: Boolean(attributes.secure),
    };
    if (index === -1) next.push(cookie);
    else next[index] = cookie;
  }
  return next;
}

// Requests OGD's home page with the saved cookies. Resolves to
// { alive: true, state } with any refreshed cookies, { alive: false } when OGD
// sent it to the login page, or { alive: null } when OGD could not be reached.
export async function touchSession(state, { fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(HOME_URL, {
      redirect: 'manual',
      headers: {
        Cookie: cookieHeader(state.cookies, HOME_URL),
        'User-Agent': state.userAgent || FALLBACK_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { alive: null };
  }
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  const cookies = applySetCookies(state.cookies, setCookies, HOME_URL);

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') || '';
    return /login/i.test(location) ? { alive: false } : { alive: null };
  }
  if (response.status !== 200) return { alive: null };
  const body = await response.text().catch(() => '');
  if (/id=["']?txtPassword/i.test(body)) return { alive: false };
  return { alive: true, state: { ...state, cookies } };
}

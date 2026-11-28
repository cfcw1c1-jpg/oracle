import { readdirSync, readFileSync, rmSync, statfsSync, statSync } from 'node:fs';
import { freemem, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import chromiumBinary from '@sparticuz/chromium';
import { chromium } from 'playwright-core';

// @sparticuz/chromium ships a Chromium build that runs inside Vercel
// Functions. OGD_CHROMIUM_PATH lets local development use an installed browser.
//
// Its arguments include --single-process, where closing one browser context
// ends the entire browser. Each attempt launches its own browser, so code must
// leave contexts open and let the caller close the browser when finished.
//
// Vercel reuses a function instance for later requests. A run that was cut
// off can leave its Chromium running and its profile folder in /tmp, and the
// next run's browser then fails with net::ERR_INSUFFICIENT_RESOURCES. So when
// no other browser of this instance is in use, leftovers are cleared first.
// A browser launched longer ago than any request may run (maxDuration 300s)
// belongs to a request that was cut off, so it no longer counts as in use.

const EXTRA_ARGS = ['--disk-cache-size=1', '--media-cache-size=1', '--disable-gpu-shader-disk-cache'];
const PROFILE_PREFIX = 'playwright_chromiumdev_profile-';
const CHROME_TEMP_PREFIX = '.com.google.Chrome.';
const BROWSER_MAX_AGE_MS = 330 * 1000;
const openBrowsers = new Map();

function killLeftoverChromium(executablePath) {
  let killed = 0;
  for (const entry of readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name) || Number(entry.name) === process.pid) continue;
    let command = '';
    try {
      command = readFileSync(`/proc/${entry.name}/cmdline`, 'utf8');
    } catch {
      continue;
    }
    if (!command.startsWith(executablePath)) continue;
    try {
      process.kill(Number(entry.name), 'SIGKILL');
      killed += 1;
    } catch {
      // Already gone.
    }
  }
  return killed;
}

function removeLeftoverProfiles() {
  let removed = 0;
  for (const name of readdirSync(tmpdir())) {
    // Chromium's own .com.google.Chrome.* temp folders pile up in /tmp too;
    // only cleared on Vercel, where no other Chrome shares /tmp.
    const isChromeTemp = Boolean(process.env.VERCEL) && name.startsWith(CHROME_TEMP_PREFIX);
    if (!name.startsWith(PROFILE_PREFIX) && !isChromeTemp) continue;
    rmSync(join(tmpdir(), name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

function clearLeftovers(executablePath) {
  const now = Date.now();
  for (const [browser, launchedAt] of openBrowsers) if (now - launchedAt > BROWSER_MAX_AGE_MS) openBrowsers.delete(browser);
  if (openBrowsers.size > 0 || process.platform !== 'linux') return;
  try {
    const killed = killLeftoverChromium(executablePath);
    const removed = removeLeftoverProfiles();
    if (killed || removed) console.log(`[ogd] cleared ${killed} leftover browser process(es) and ${removed} profile folder(s)`);
  } catch (error) {
    console.error('[ogd] could not clear browser leftovers:', error.message);
  }
}

// After a browser died: clears leftovers if no other browser of this instance
// is still in use, so the next launch starts clean.
export function recoverFromCrash() {
  const executablePath = process.env.OGD_CHROMIUM_PATH;
  if (executablePath) return;
  chromiumBinary.executablePath().then(clearLeftovers).catch(() => null);
}

const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;

// What the instance looked like when a browser died: free memory, free /tmp
// space, the biggest things in /tmp, Chromium processes still running, and
// the browser's own last log lines.
export function crashReport(browser) {
  const parts = [];
  try {
    parts.push(`memory free ${mb(freemem())} of ${mb(totalmem())}, node rss ${mb(process.memoryUsage().rss)}`);
  } catch {}
  try {
    const fs = statfsSync(tmpdir());
    parts.push(`/tmp free ${mb(fs.bavail * fs.bsize)} of ${mb(fs.blocks * fs.bsize)}`);
  } catch {}
  try {
    const entries = readdirSync(tmpdir()).map((name) => {
      try {
        return { name, size: statSync(join(tmpdir(), name)).size };
      } catch {
        return { name, size: 0 };
      }
    });
    parts.push(`/tmp has ${entries.length} entries: ${entries.sort((a, b) => b.size - a.size).slice(0, 8).map((entry) => entry.name).join(', ')}`);
  } catch {}
  try {
    const chromiumProcesses = readdirSync('/proc').filter((name) => {
      if (!/^\d+$/.test(name) || Number(name) === process.pid) return false;
      try {
        return /chrom/i.test(readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0')[0]);
      } catch {
        return false;
      }
    });
    parts.push(`${chromiumProcesses.length} chromium process(es) running, ${openBrowsers.size} browser(s) in use here`);
  } catch {}
  const lines = browserLogs.get(browser) ?? [];
  if (lines.length) parts.push(`browser said: ${lines.slice(-15).join(' | ')}`);
  return parts.join('; ');
}

const browserLogs = new WeakMap();
const LOG_LINES_KEPT = 40;

// Pictures, fonts and media are never needed to read or fill OGD's pages.
const SKIPPED_RESOURCES = new Set(['image', 'font', 'media']);

export async function launchBrowser() {
  const executablePath = process.env.OGD_CHROMIUM_PATH || (await chromiumBinary.executablePath());
  if (!process.env.OGD_CHROMIUM_PATH) clearLeftovers(executablePath);

  // Chromium's own output (stderr), kept so a crash can be explained.
  const lines = [];
  const logger = {
    isEnabled: (name) => name === 'browser',
    log: (_name, _severity, message) => {
      lines.push(String(message).slice(0, 300));
      if (lines.length > LOG_LINES_KEPT) lines.shift();
    },
  };
  const browser = await chromium.launch({ args: [...chromiumBinary.args, ...EXTRA_ARGS], executablePath, headless: true, logger });
  browserLogs.set(browser, lines);
  openBrowsers.set(browser, Date.now());
  browser.on('disconnected', () => {
    openBrowsers.delete(browser);
  });

  // Every context this browser makes skips the heavy resources.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext(options);
    await context.route('**/*', (route) => (SKIPPED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue()));
    return context;
  };
  return browser;
}

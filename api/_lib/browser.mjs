import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    if (!name.startsWith(PROFILE_PREFIX)) continue;
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

// Pictures, fonts and media are never needed to read or fill OGD's pages.
const SKIPPED_RESOURCES = new Set(['image', 'font', 'media']);

export async function launchBrowser() {
  const executablePath = process.env.OGD_CHROMIUM_PATH || (await chromiumBinary.executablePath());
  if (!process.env.OGD_CHROMIUM_PATH) clearLeftovers(executablePath);

  const browser = await chromium.launch({ args: [...chromiumBinary.args, ...EXTRA_ARGS], executablePath, headless: true });
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

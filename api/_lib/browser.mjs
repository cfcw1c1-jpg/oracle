import chromiumBinary from '@sparticuz/chromium';
import { chromium } from 'playwright-core';

// @sparticuz/chromium ships a Chromium build that runs inside Vercel
// Functions. OGD_CHROMIUM_PATH lets local development use an installed browser.
//
// Its arguments include --single-process, where closing one browser context
// ends the entire browser. Each attempt launches its own browser, so code must
// leave contexts open and let the caller close the browser when finished.
export async function launchBrowser() {
  const executablePath = process.env.OGD_CHROMIUM_PATH || (await chromiumBinary.executablePath());
  return chromium.launch({ args: chromiumBinary.args, executablePath, headless: true });
}

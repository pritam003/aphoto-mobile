/**
 * Debug script: verify EXIF extraction works end-to-end
 * Run: node scripts/debug-exif.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import path from 'path';

const TEST_IMAGE = '/Users/pritamprasad/Downloads/IMG_20200227_002011251.jpg';
const APP_URL = 'https://green-river-0bfcd7a0f.1.azurestaticapps.net';

const browser = await chromium.launch({ headless: false, slowMo: 300 });
const context = await browser.newContext();
const page = await context.newPage();

// --- 1. Capture console messages ---
const consoleLogs = [];
page.on('console', msg => {
  consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
});

// --- 2. Intercept /photos/register to inspect takenAt ---
let registerBody = null;
let registerResponse = null;
await page.route('**/api/photos/register', async route => {
  const req = route.request();
  registerBody = JSON.parse(req.postData() || '{}');
  console.log('\n=== /photos/register request body ===');
  console.log(JSON.stringify(registerBody, null, 2));

  const resp = await route.fetch();
  registerResponse = await resp.json();
  console.log('\n=== /photos/register response ===');
  console.log(JSON.stringify(registerResponse, null, 2));
  await route.fulfill({ response: resp, json: registerResponse });
});

// --- 3. Navigate and wait for app ---
await page.goto(APP_URL, { waitUntil: 'networkidle' });

// Check if logged in (sidebar has "Photos" link)
const isLoggedIn = await page.locator('text=Upload Photos').isVisible().catch(() => false);
if (!isLoggedIn) {
  console.log('\n❌ Not logged in — please log in first and re-run.');
  await browser.close();
  process.exit(1);
}

// --- 4. Open upload modal ---
await page.click('button:has-text("Upload Photos")');
await page.waitForSelector('input[type="file"]', { timeout: 5000 });

// --- 5. Upload the test image ---
const inputEl = page.locator('input[type="file"]');
await inputEl.setInputFiles(TEST_IMAGE);

// Wait a tick for EXIF extraction (async)
await page.waitForTimeout(1000);

// --- 6. Click upload button ---
const uploadBtn = page.locator('button:has-text("Upload")').last();
await uploadBtn.click();

// Wait for upload to complete
await page.waitForTimeout(4000);

// --- 7. Test exifr directly in the browser page context ---
const exifResult = await page.evaluate(async (imageBase64) => {
  const { default: exifr } = await import('https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs');
  const bytes = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
  const result = await exifr.parse(bytes.buffer, {
    pick: ['DateTimeOriginal', 'DateTimeDigitized', 'CreateDate', 'DateTime'],
  });
  return result;
}, readFileSync(TEST_IMAGE).toString('base64'));

console.log('\n=== exifr.parse result in browser ===');
console.log(JSON.stringify(exifResult, null, 2));

console.log('\n=== Console logs ===');
consoleLogs.forEach(l => console.log(l));

console.log('\n=== Summary ===');
console.log('takenAt sent to API:', registerBody?.takenAt ?? '(none — EXIF extraction failed)');
console.log('takenAt stored in DB:', registerResponse?.takenAt ?? '(null)');

await browser.close();

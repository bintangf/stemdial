import {writeFile} from 'node:fs/promises';

const pw = process.env.PLAYWRIGHT || `${process.env.HOME}/.npm/_npx/9b9809298fe40d2c/node_modules/playwright-core`;
const {chromium} = await import(new URL('index.mjs', `file://${pw.replace(/\/$/, '')}/`).href);
const BASE = process.env.BASE || 'http://127.0.0.1:8125/tools/harness.html';

const browser = await chromium.launchPersistentContext('', {
  executablePath: process.env.CHROME,
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  page.on('console', (m) => console.log('console:', m.text()));
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(BASE);
  await page.waitForFunction(() => window.runHarness, null, {timeout: 30000});
  await page.evaluate(() => window.runHarness());
  try {
    await page.waitForFunction(() => window.__report, null, {timeout: 90000});
  } catch (error) {
    console.log('status:', await page.textContent('#status').catch(() => '?'));
    console.log('report:', JSON.stringify(await page.evaluate(() => window.__report).catch(() => null)));
    throw error;
  }
  const report = await page.evaluate(() => window.__report);
  const {inference, latency, ...rest} = report;
  const out = {...rest, inference: inference.map((x) => +x.toFixed(1)), latency: latency.map((x) => +x.toFixed(0))};
  console.log(JSON.stringify(out, null, 2));
  await writeFile(new URL('./measurement.json', import.meta.url), JSON.stringify(out, null, 2));
  if (report.error) process.exitCode = 1;
} finally {
  await browser.close();
}

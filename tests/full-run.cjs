"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const route = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const file = path.resolve(root, `.${route}`);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

let browser;
async function optimizeParty(page) {
  await page.locator("#pauseButton").click().catch(() => {});
  await page.locator('[data-view="inventory"]').click();
  const sort = page.locator("[data-sort]");
  if (await sort.count()) await sort.click();
  let sharedIndex = 0;
  for (let i = 0; i < 12; i++) {
    const items = page.locator(".item-slot");
    if (!(await items.count())) break;
    await items.first().click();
    const equip = page.locator("[data-equip]");
    const count = await equip.count();
    if (!count) break;
    await equip.nth(count === 1 ? 0 : sharedIndex++ % count).click();
  }
  await page.locator("#closeDrawer").click();
  await page.locator('[data-view="skills"]').click();
  for (let i = 0; i < 8; i++) {
    const upgrades = page.locator("[data-skill]:not([disabled])");
    if (!(await upgrades.count())) break;
    await upgrades.first().click();
  }
  await page.locator("#closeDrawer").click();
  await page.locator('[data-view="map"]').click();
  await page.locator('[data-stage="10"]').click();
}

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  browser = await chromium.launch({ headless: true, executablePath: fs.existsSync(edge) ? edge : undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "networkidle" });
  await page.locator("#startButton").click();
  await page.locator("#speedButton").click();
  await page.locator("#speedButton").click();
  let reachedBossClear = false;
  let optimized = false;
  let previousStatus = "";
  for (let attempt = 0; attempt < 72; attempt++) {
    await page.waitForTimeout(5000);
    const status = await page.evaluate(() => {
      const save = JSON.parse(localStorage.getItem("starwish_demo_save_v1"));
      return { stage: save.currentStage, mode: save.mode, level: save.level, failures: save.failures, clears: Object.keys(save.firstClears || {}).length, boss: Boolean(save.firstClears && save.firstClears[10]) };
    });
    const label = JSON.stringify(status);
    if (label !== previousStatus) { console.log(`Progress ${label}`); previousStatus = label; }
    if (!optimized && status.stage === 10 && status.failures >= 1) {
      console.log("Applying intended player progression through inventory and skill UI.");
      await optimizeParty(page);
      optimized = true;
    }
    if (status.boss) { reachedBossClear = true; break; }
  }
  if (!reachedBossClear) throw new Error("Natural run did not clear stage 10 within six minutes");
  const result = await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem("starwish_demo_save_v1"));
    return { level: save.level, gold: save.gold, clears: save.totalClears, firstClears: Object.keys(save.firstClears).length, inventory: save.inventory.length };
  });
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  if (result.firstClears !== 10) throw new Error(`Only ${result.firstClears}/10 first clears recorded`);
  await page.screenshot({ path: path.join(root, "tests", "full-run-boss-reward.png"), fullPage: true });
  console.log(`Full natural run passed: ${JSON.stringify(result)}`);
  await browser.close(); server.close();
})().catch(async error => {
  console.error(error);
  if (browser) await browser.close().catch(() => {});
  server.close(); process.exitCode = 1;
});

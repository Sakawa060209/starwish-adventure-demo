"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

const server = http.createServer((req, res) => {
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const file = path.resolve(root, `.${urlPath}`);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end("Not found"); return; }
  res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

let browser;
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  browser = await chromium.launch({ headless: true, executablePath: fs.existsSync(edge) ? edge : undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  await page.locator("#startButton").click();
  await page.locator("#speedButton").click();
  await page.locator("#speedButton").click();
  await page.waitForFunction(() => document.querySelector("#battleStatus").textContent.includes("战斗"), null, { timeout: 12000 });
  if ((await page.locator("#partyHud .hero-card").count()) !== 4) throw new Error("Party HUD does not contain four heroes");
  await page.waitForFunction(() => document.querySelector("#stageLabel").textContent.trim() === "1-2", null, { timeout: 45000 });
  await page.locator('[data-view="inventory"]').click();
  if ((await page.locator(".item-slot").count()) < 1) throw new Error("First clear did not award equipment");
  if ((await page.locator(".gear-sprite").count()) < 1) throw new Error("Pixel equipment icons were not rendered");
  await page.screenshot({ path: path.join(root, "tests", "smoke-inventory.png"), fullPage: true });
  await page.locator("#closeDrawer").click();
  await page.locator('[data-view="formation"]').click();
  if ((await page.locator(".formation-unit").count()) !== 4) throw new Error("Formation does not contain four heroes");
  if ((await page.locator(".formation-unit .p-face").count()) !== 4) throw new Error("Original pixel portraits were not rendered");
  await page.screenshot({ path: path.join(root, "tests", "smoke-formation.png"), fullPage: true });
  await page.locator("#closeDrawer").click();
  await page.locator('[data-view="map"]').click();
  if ((await page.locator(".stage-card").count()) !== 10) throw new Error("Map does not contain ten stages");
  await page.locator("#closeDrawer").click();
  const saveExists = await page.evaluate(() => Boolean(localStorage.getItem("starwish_demo_save_v1")));
  if (!saveExists) throw new Error("Save was not created");
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  await page.screenshot({ path: path.join(root, "tests", "smoke-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflow) throw new Error("Mobile viewport has document-level horizontal overflow");
  await page.screenshot({ path: path.join(root, "tests", "smoke-mobile.png"), fullPage: true });
  console.log("Browser smoke passed: battle, formation, map, save, mobile overflow, and console checks.");
  await browser.close();
  server.close();
})().catch(error => {
  console.error(error);
  if (browser) browser.close().catch(() => {});
  server.close();
  process.exitCode = 1;
});

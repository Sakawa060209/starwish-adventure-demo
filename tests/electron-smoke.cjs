"use strict";

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { _electron: electron } = require("playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  const executablePath = path.join(root, "release", "win-unpacked", "星愿物语.exe");
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "starwish-electron-"));
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${userDataDir}`] });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.waitForLoadState("domcontentloaded");
  await page.locator("#startButton:not([disabled])").waitFor({ timeout: 15000 });
  await page.locator("#startButton").click();
  await page.waitForFunction(() => document.querySelector("#battleStatus").textContent.includes("自动"), null, { timeout: 10000 });
  if ((await page.locator("#partyHud .hero-card").count()) !== 4) throw new Error("Desktop build did not render all four heroes");
  if (errors.length) throw new Error(`Desktop build errors: ${errors.join(" | ")}`);
  await page.screenshot({ path: path.join(root, "tests", "electron-desktop.png"), fullPage: true });
  await app.close();
  console.log("Electron smoke passed: packaged Windows app launched, started, and rendered four heroes.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

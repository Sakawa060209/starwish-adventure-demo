"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const inputDir = path.join(root, "assets", "design");
const outputDir = path.join(root, "assets", "sprites");
const heroes = ["mage", "archer", "lancer", "knight"];
const frameNames = ["idle", "walk-a", "walk-b", "attack", "skill", "hurt"];
const portraitCrops = {
  mage: { left: 78, top: 0, width: 210, height: 210 },
  archer: { left: 72, top: 0, width: 210, height: 210 },
  lancer: { left: 92, top: 0, width: 210, height: 210 },
  knight: { left: 82, top: 0, width: 210, height: 210 }
};

const isBackground = (data, offset) => {
  const r = data[offset], g = data[offset + 1], b = data[offset + 2];
  return r >= 235 && g >= 233 && b >= 230 && Math.max(r, g, b) - Math.min(r, g, b) <= 18;
};

function findBounds(data, width, height, channels) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      if (isBackground(data, offset)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("No foreground pixels found in sprite cell");
  return { minX, minY, maxX, maxY };
}

function clearConnectedBackground(data, width, height) {
  const size = width * height;
  const seen = new Uint8Array(size);
  const queue = new Int32Array(size);
  let head = 0, tail = 0;
  const add = (index) => {
    if (index < 0 || index >= size || seen[index] || !isBackground(data, index * 4)) return;
    seen[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y++) { add(y * width); add(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++], x = index % width;
    data[index * 4 + 3] = 0;
    if (x > 0) add(index - 1);
    if (x + 1 < width) add(index + 1);
    if (index >= width) add(index - width);
    if (index + width < size) add(index + width);
  }
  // Bow strings and spell rings can enclose large paper-white backdrop islands.
  // Detect those by area, then expand through their softer off-white edge pixels.
  const islandSeen = new Uint8Array(size);
  const islandQueue = new Int32Array(size);
  const isPaperWhite = index => {
    const offset = index * 4, r = data[offset], g = data[offset + 1], b = data[offset + 2];
    return data[offset + 3] > 0 && r >= 248 && g >= 248 && b >= 247 && Math.max(r, g, b) - Math.min(r, g, b) <= 7;
  };
  for (let start = 0; start < size; start++) {
    if (islandSeen[start] || !isPaperWhite(start)) continue;
    let islandHead = 0, islandTail = 0;
    islandSeen[start] = 1; islandQueue[islandTail++] = start;
    while (islandHead < islandTail) {
      const index = islandQueue[islandHead++], x = index % width;
      const visit = next => {
        if (next < 0 || next >= size || islandSeen[next] || !isPaperWhite(next)) return;
        islandSeen[next] = 1; islandQueue[islandTail++] = next;
      };
      if (x > 0) visit(index - 1);
      if (x + 1 < width) visit(index + 1);
      if (index >= width) visit(index - width);
      if (index + width < size) visit(index + width);
    }
    if (islandTail < 500) continue;
    head = 0; tail = islandTail;
    for (let i = 0; i < islandTail; i++) { queue[i] = islandQueue[i]; data[islandQueue[i] * 4 + 3] = 0; }
    while (head < tail) {
      const index = queue[head++], x = index % width;
      const expand = next => {
        if (next < 0 || next >= size || !data[next * 4 + 3] || !isBackground(data, next * 4)) return;
        data[next * 4 + 3] = 0; queue[tail++] = next;
      };
      if (x > 0) expand(index - 1);
      if (x + 1 < width) expand(index + 1);
      if (index >= width) expand(index - width);
      if (index + width < size) expand(index + width);
    }
  }
}

async function extractHero(hero) {
  const source = path.join(inputDir, `${hero}-sheet.png`);
  const meta = await sharp(source).metadata();
  const cellWidth = Math.floor(meta.width / 3);
  const cellHeight = Math.floor(meta.height / 2);
  const frames = [];

  for (let index = 0; index < 6; index++) {
    const col = index % 3, row = Math.floor(index / 3);
    const cell = await sharp(source)
      .extract({ left: col * cellWidth, top: row * cellHeight, width: cellWidth, height: cellHeight })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bounds = findBounds(cell.data, cellWidth, cellHeight, 4);
    const pad = 8;
    const left = Math.max(0, bounds.minX - pad);
    const top = Math.max(0, bounds.minY - pad);
    const right = Math.min(cellWidth - 1, bounds.maxX + pad);
    const bottom = Math.min(cellHeight - 1, bounds.maxY + pad);
    const width = right - left + 1, height = bottom - top + 1;
    const cropped = await sharp(cell.data, { raw: { width: cellWidth, height: cellHeight, channels: 4 } })
      .extract({ left, top, width, height })
      .raw()
      .toBuffer();
    clearConnectedBackground(cropped, width, height);
    const file = `${hero}-${frameNames[index]}.png`;
    await sharp(cropped, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9, palette: true, quality: 100 })
      .toFile(path.join(outputDir, file));
    frames.push({
      name: frameNames[index],
      src: `assets/sprites/${file}`,
      width,
      height,
      anchorX: Math.round(cellWidth / 2 - left),
      anchorY: bounds.maxY - top + 1
    });
  }
  const portrait = portraitCrops[hero];
  await sharp(path.join(outputDir, `${hero}-idle.png`))
    .extract(portrait)
    .resize(128, 128, { fit: "cover", kernel: "nearest" })
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(path.join(outputDir, `${hero}-portrait.png`));
  return frames;
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const manifest = {};
  for (const hero of heroes) manifest[hero] = await extractHero(hero);
  fs.writeFileSync(
    path.join(outputDir, "manifest.js"),
    `window.STARWISH_SPRITES = ${JSON.stringify(manifest, null, 2)};\n`,
    "utf8"
  );
  console.log(JSON.stringify(manifest, null, 2));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

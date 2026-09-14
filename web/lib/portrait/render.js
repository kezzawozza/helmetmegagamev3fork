import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  BUST_PX,
  CANVAS,
  CROP_X,
  CROP_Y,
  FADE_DARKEN,
  FADE_HEIGHT,
  FADE_TINT,
  LAYERS,
  PLATE_SRC,
  SHEET_DIR,
  SHIFT_X,
  TILE,
  buildPalette,
  recolor,
  tileRect,
} from "./catalog";

// sharp's extract() refuses a window that overhangs, so pad the bust out to hold it first.
const PAD_TOP = Math.max(0, -CROP_Y);
const PAD_LEFT = Math.max(0, -CROP_X);
const PAD_BOTTOM = Math.max(0, CROP_Y + CANVAS - BUST_PX);
const PAD_RIGHT = Math.max(0, CROP_X + CANVAS - BUST_PX);

// Cached like the sheets — it never changes. Drawn OVER the finished bust, to swallow the chin cut.
let fadeSvgCache = null;
function fadeSvg() {
  if (fadeSvgCache) return fadeSvgCache;
  const h = Math.round(CANVAS * FADE_HEIGHT);
  const { r, g, b } = FADE_TINT;
  const c = `rgb(${Math.round(r * FADE_DARKEN)},${Math.round(g * FADE_DARKEN)},${Math.round(b * FADE_DARKEN)})`;
  fadeSvgCache = Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${c}" stop-opacity="0"/>` +
      `<stop offset="1" stop-color="${c}" stop-opacity="1"/>` +
      `</linearGradient></defs>` +
      `<rect x="0" y="${CANVAS - h}" width="${CANVAS}" height="${h}" fill="url(#f)"/></svg>`,
  );
  return fadeSvgCache;
}

// The server half of the pair in catalog.js — runs once, on save, into Character.avatarData.
// The client NEVER posts pixels, only the selection, re-rendered here from the catalog — the
// worst a forged request can do is pick a different nose. See docs/systemdocs/PORTRAITS.md.

const ASSET_ROOT = path.join(process.cwd(), "public");
const assetCache = new Map();

// Cache the encoded PNGs, not decoded pixels: decoding is free next to holding that resident.
function readAsset(publicPath) {
  if (!assetCache.has(publicPath)) {
    assetCache.set(
      publicPath,
      fs.readFile(path.join(ASSET_ROOT, publicPath)).catch((err) => {
        assetCache.delete(publicPath);
        throw err;
      }),
    );
  }
  return assetCache.get(publicPath);
}

function isBlank(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) return false;
  return true;
}

export async function renderPortrait(selection) {
  const palette = buildPalette(selection);

  const composites = [];
  for (const layer of LAYERS) {
    // A null group is a layer with exactly one tile and no choice (the cranium).
    const index = layer.group === null ? 0 : selection[layer.group];
    if (!Number.isInteger(index)) continue;

    const sheet = await readAsset(`${SHEET_DIR}/${layer.file}`);
    const { data, info } = await sharp(sheet)
      .extract(tileRect(index))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (isBlank(data)) continue;

    recolor(data, palette);
    composites.push({
      input: await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .png()
        .toBuffer(),
      left: SHIFT_X,
      top: 0,
    });
  }

  // Composited onto a tile-width canvas first, then scaled once — scaling each layer would soften
  // every seam. Canvas is TILE + SHIFT_X wide so the shift fits (sharp refuses an overhanging composite).
  const shifted = await sharp({
    create: { width: TILE + SHIFT_X, height: TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toBuffer();

  // Nearest, not the default Lanczos: this is pixel art. Two passes, not one — sharp runs extend()
  // AFTER the post-resize extract() regardless of call order, so chaining them broke the composite.
  const padded = await sharp(shifted)
    .extract({ left: 0, top: 0, width: TILE, height: TILE })
    .resize(BUST_PX, BUST_PX, { kernel: "nearest" })
    .extend({
      top: PAD_TOP,
      bottom: PAD_BOTTOM,
      left: PAD_LEFT,
      right: PAD_RIGHT,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const bust = await sharp(padded)
    .extract({
      left: CROP_X + PAD_LEFT,
      top: CROP_Y + PAD_TOP,
      width: CANVAS,
      height: CANVAS,
    })
    .png()
    .toBuffer();

  return sharp(await readAsset(PLATE_SRC))
    .composite([{ input: bust }, { input: fadeSvg() }])
    .webp({ quality: 90 })
    .toBuffer();
}

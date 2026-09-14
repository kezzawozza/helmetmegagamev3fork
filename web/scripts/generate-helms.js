// Generates the concealed-identity avatars: one plated 256px WebP per piece
// of concealing headgear, from the 32x32 source sprites in web/assets/helms.
// A character wearing something with Tag.concealsIdentity is served one of
// these, chosen by Tag.concealSprite (db/lib/presentedIdentity.js) — no
// per-character render, every wearer of a given helm looks identical.
// One-off with committed output — re-run after adding a sprite or changing
// the tuning constants below:
//
//   npm run assets:helms --workspace=web
//
// The plate and bottom fade match a built portrait's, same reason
// generate-letters.js shares the plate: a helm and a face turn up side by
// side in one channel.

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(ROOT, "assets/helms");
const OUT_DIR = path.join(ROOT, "public/assets/helms");
const PLATE = path.join(ROOT, "public/assets/portrait/plate.webp");

// --- Tuning -----------------------------------------------------------------
const SIZE = 256; // CANVAS in web/lib/portrait/catalog.js
// Target for the GEOMETRIC MEAN of the sprite's tight bounding box (sqrt(w*h)
// holds apparent visual MASS constant, which is what the eye compares).
const TARGET = 245;
const CENTRE_Y = 0.47; // fraction of canvas height the sprite's centre sits at; dead centre reads as floating

// Matches the built portrait's bottom fade (web/lib/portrait/catalog.js's
// FADE_TINT/FADE_DARKEN/FADE_HEIGHT); duplicated since that module is ESM.
const FADE_HEIGHT = 0.3;
const FADE_TINT = { r: 0, g: 0, b: 0 };
const FADE_DARKEN = 1;

function fadeSvg() { // built once, reused across all sprites
  const h = Math.round(SIZE * FADE_HEIGHT);
  const { r, g, b } = FADE_TINT;
  const c = `rgb(${Math.round(r * FADE_DARKEN)},${Math.round(g * FADE_DARKEN)},${Math.round(b * FADE_DARKEN)})`;
  return Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${c}" stop-opacity="0"/>` +
      `<stop offset="1" stop-color="${c}" stop-opacity="1"/>` +
      `</linearGradient></defs>` +
      `<rect x="0" y="${SIZE - h}" width="${SIZE}" height="${h}" fill="url(#f)"/></svg>`,
  );
}
const FADE = fadeSvg();

// Tight bounding box of everything non-transparent, so normalisation
// measures the ART, not the differently-padded 32x32 cell it was cut from.
function boundingBox(data, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 10) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

async function build(file) {
  const name = path.basename(file, ".png");
  const src = path.join(SRC_DIR, file);

  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const box = boundingBox(data, info.width, info.height);
  if (!box) throw new Error(`${file} is entirely transparent`);

  // Geometric-mean rule, then a clamp: a wide brim or tall plume that would
  // overshoot the canvas scales down alone rather than lowering TARGET for all.
  let scale = TARGET / Math.sqrt(box.width * box.height);
  scale = Math.min(scale, SIZE / box.width, SIZE / box.height);
  const w = Math.round(box.width * scale);
  const h = Math.round(box.height * scale);

  // Nearest, not the default Lanczos: pixel art, every other kernel turns hard
  // edges to mush. Two sharp calls, not one chain — sharp's fixed pipeline
  // order runs extract() and resize() in its own sequence regardless
  // (web/lib/portrait/render.js documents the same trap).
  const cropped = await sharp(src).extract(box).png().toBuffer();
  const scaled = await sharp(cropped).resize(w, h, { kernel: "nearest" }).png().toBuffer();

  const left = Math.round((SIZE - w) / 2);
  const top = Math.max(0, Math.min(SIZE - h, Math.round(SIZE * CENTRE_Y - h / 2))); // clamped, or a full-height sprite loses its crown

  await sharp(PLATE)
    .composite([{ input: scaled, left, top }, { input: FADE, left: 0, top: 0 }])
    .webp({ quality: 90 })
    .toFile(path.join(OUT_DIR, `${name}.webp`));

  return { name, box: `${box.width}x${box.height}`, out: `${w}x${h}` };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const files = (await fs.readdir(SRC_DIR)).filter((f) => f.endsWith(".png")).sort();
  if (!files.length) throw new Error(`no source sprites in ${SRC_DIR}`);

  for (const file of files) {
    const r = await build(file);
    console.log(`  ${r.name.padEnd(18)} ${r.box.padEnd(8)} -> ${r.out}`);
  }
  console.log(`\n${files.length} helm avatars -> ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

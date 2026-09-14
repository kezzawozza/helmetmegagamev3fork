// Generates the default character avatars: a teal-tinted stone plaque with a
// blackletter capital, A-Z plus a blank fallback, served by
// web/app/api/avatar/[characterId]/route.js off the character's FIRST name.
// One-off with committed output — re-run `npm run assets:letters
// --workspace=web` after changing the tuning constants below or
// background.png. The font is vendored as a TTF because pango (sharp's text
// support) cannot read the .woff2 next/font/google caches.
//
// **Check the output before committing it.** On a machine with no fontconfig
// setup, pango silently substitutes a default sans face and the script still
// exits 0 — open one plaque and look. If it happens, fix the constants below
// for next time and post-process the already-committed plaques by hand; use
// `--plate-only` (see main) to move the plate without touching a glyph.

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const BACKGROUND = path.join(ROOT, "public/assets/background.png");
const FONT_FILE = path.join(ROOT, "assets/fonts/UnifrakturMaguntia.ttf");
const OUT_DIR = path.join(ROOT, "public/assets/letters");
// The same tinted stone, frameless, as the backing plate for a built portrait
// (docs/systemdocs/PORTRAITS.md) — kept here so a portrait and a letter
// plaque never drift out of matching.
const PORTRAIT_PLATE = path.join(ROOT, "public/assets/portrait/plate.webp");

// --- Tuning -----------------------------------------------------------------
const SIZE = 256; // matches AVATAR_SIZE in character/actions.js
// `null` (not a grey triple): sharp's .tint() on a greyscale image is a
// colorize, and there's no such thing as tinting something its own colour.
// Put an { r, g, b } back here to bring a hue back.
const TINT = null;
const DARKEN = 0.4; // brightness multiplier; the plate has to stay well under the ink
const BLUR = 2.5; // abstracts the source photo into mottled stone rather than a legible forest
// Vertical darkening ramp so anything standing on the plate reads as sitting
// on it. Black rather than teal, deepening the stone instead of hue-shifting it.
const SHADE_TOP = 0.0; // opacity where the ramp begins
const SHADE_BOTTOM = 0.5; // opacity at the bottom edge
const SHADE_START = 0.15; // fraction down the plate the ramp begins
// Tone map over the finished ground alone (glyph/helm/bust composite AFTER).
// linear(), not a smaller DARKEN, since modulate({brightness}) can't express
// a negative offset; fitted by least squares against the committed plaques.
const TONE_GAIN = 1.4041;
const TONE_OFFSET = -39.17;
const INK = "#efe7d6"; // Dusk's --text, warmer than pure white; "#ffffff" for a colder plaque
const GLYPH_BOX = 132; // the square the trimmed glyph is fitted into
const FRAME_INSET = 18; // white rule, echoing the frame on an illuminated initial
const FRAME_WIDTH = 2;
const FRAME_OPACITY = 0.85;
const WEBP_QUALITY = 88; // matches what updateCharacterProfile stores for an uploaded avatar
// ----------------------------------------------------------------------------

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// The tinted stone tile, shared by every letter — rendered once. Tint stays a
// separate, final pass: chaining .tint() and .modulate() in one pipeline
// silently drops the tint (sharp applies modulate after tint and clears the
// chroma).
async function buildPlate() {
  const stone = await sharp(BACKGROUND)
    .resize(SIZE, SIZE, { fit: "cover" })
    .greyscale()
    .blur(BLUR) // turns the hillside photo into mottled stone rather than legible trees
    .modulate({ brightness: DARKEN })
    .png()
    .toBuffer();

  const tinted = TINT ? await sharp(stone).tint(TINT).png().toBuffer() : stone;
  // Tone map last, over the finished ground including its shade ramp — it's
  // graded against that finished ground, so it can't fold into DARKEN above.
  return sharp(tinted)
    .composite([{ input: shadeSvg() }])
    .linear(TONE_GAIN, TONE_OFFSET)
    .png()
    .toBuffer();
}

// The darkening ramp, over the full canvas. Starts at SHADE_START rather than
// the top edge so the lit half stays lit and only the lower plate falls away.
function shadeSvg() {
  return Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
       <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0" stop-color="#000" stop-opacity="${SHADE_TOP}" />
         <stop offset="${SHADE_START}" stop-color="#000" stop-opacity="${SHADE_TOP}" />
         <stop offset="1" stop-color="#000" stop-opacity="${SHADE_BOTTOM}" />
       </linearGradient></defs>
       <rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="url(#s)" />
     </svg>`,
  );
}

function frameSvg() {
  const inset = FRAME_INSET;
  const side = SIZE - inset * 2;
  return Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
       <rect x="${inset}" y="${inset}" width="${side}" height="${side}"
             fill="none" stroke="${INK}" stroke-width="${FRAME_WIDTH}"
             stroke-opacity="${FRAME_OPACITY}" />
     </svg>`,
  );
}

// Blackletter capitals differ wildly in width and in how far they overshoot
// the baseline, so rendering every glyph at one point size makes some tower
// over others. Render big, trim to the actual ink, then fit that into a fixed
// box — every letter then reads as the same visual weight.
async function renderGlyph(letter) {
  const raw = await sharp({
    text: {
      text: `<span foreground="${INK}">${letter}</span>`,
      font: "UnifrakturMaguntia 200",
      fontfile: FONT_FILE,
      rgba: true,
    },
  })
    .png()
    .toBuffer();

  return sharp(raw)
    .trim()
    .resize(GLYPH_BOX, GLYPH_BOX, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// `--plate-only` rebuilds portrait/plate.webp and stops, leaving the 27
// plaques alone — safe on a machine hit by the fontconfig trap above, since
// the plate needs no font. Re-run `npm run assets:helms` after, and
// post-process the existing plaques to match by hand. See PORTRAITS.md.
const PLATE_ONLY = process.argv.includes("--plate-only");

async function main() {
  for (const file of PLATE_ONLY ? [BACKGROUND] : [BACKGROUND, FONT_FILE]) {
    try {
      await fs.access(file);
    } catch {
      console.error(`Missing required asset: ${path.relative(ROOT, file)}`);
      process.exit(1);
    }
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const plate = await buildPlate();
  const frame = frameSvg();

  await fs.mkdir(path.dirname(PORTRAIT_PLATE), { recursive: true });
  await sharp(plate).webp({ quality: WEBP_QUALITY }).toFile(PORTRAIT_PLATE);

  if (PLATE_ONLY) {
    console.log(`done (plate only -> ${path.relative(ROOT, PORTRAIT_PLATE)})`);
    return;
  }

  // The fallback: plaque and frame, no glyph. Served for an initial that is
  // not a plain A-Z — an accented or non-Latin first letter, a digit, or a
  // character whose firstName is somehow empty.
  await sharp(plate)
    .composite([{ input: frame }])
    .webp({ quality: WEBP_QUALITY })
    .toFile(path.join(OUT_DIR, "_default.webp"));

  for (const letter of LETTERS) {
    const glyph = await renderGlyph(letter);
    await sharp(plate)
      .composite([{ input: frame }, { input: glyph, gravity: "centre" }])
      .webp({ quality: WEBP_QUALITY })
      .toFile(path.join(OUT_DIR, `${letter}.webp`));
  }

  console.log(
    `done (${LETTERS.length} letters + _default -> ${path.relative(ROOT, OUT_DIR)}, ` +
      `plate -> ${path.relative(ROOT, PORTRAIT_PLATE)})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

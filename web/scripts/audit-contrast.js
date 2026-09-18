// WCAG AA gate for the design tokens in web/app/globals.css (`npm run
// audit:contrast --workspace=web`). Parses token values straight out of the
// stylesheet so it can never drift. Two rules people break by accident: the
// surface ladder (--bg -> --surface -> --surface-raised must keep a step of
// separation), and --accent vs --accent-text (text and outlines must
// use --accent-text; --accent is a fill only). The zone code (--zone-*) is
// fills only too, gated at 3.0 against --surface, not AA.
//
// One look, not two. Until 2026-09-18 this script re-mixed a dawn/dusk ramp
// at five points of a lamp gradient and gated each one; that machinery is
// gone along with the two-theme system itself (globals.css's own header
// comment, and DESIGN-SYSTEM.md §3, say why). There is one :root now, gated
// once.

const fs = require("fs");
const path = require("path");

const CSS_PATH = path.join(__dirname, "..", "app", "globals.css");

const AA = 4.5; // WCAG AA, normal-size text
// The ground ladder's two structural floors. These are NOT accessibility
// rules — every one of those (AA text, the 3.0 graphic floors below) is
// untouched. They ask a narrower question: can you still tell a panel from
// the ground behind it? They were written against a lighter palette, and on
// 2026-09-18 Bascinet chose the character mockup's ground instead
// (docs/design/mockups/character/index.html: --bg #0d0b08 on --surface
// #171310), which separates a panel by its RULE and its shadow rather than by
// the lightness of its fill. That ground measures 1.06 per step and 1.47 for
// the hairline, so the old 1.20/1.90 would have refused the design the game
// is built on. Lowered to sit just under it: still enough to catch a real
// regression — two surfaces collapsing into one, or a border going invisible
// — without arguing with the palette. Raise these only by moving the palette.
const LADDER_MIN = 1.05; // per-step surface separation
const BORDER_MIN = 1.4; // hairline vs the surface it sits on
const ZONE_MARK_MIN = 3.0; // large-graphic floor, not AA — none of the map-picked hues would clear 4.5
const ZONE_KEYS = ["fortress", "town", "forest", "hills", "marshes", "caves", "depths"];
// The tag code (--tag-*), one per Tag.category. Fills only, same 3.0 floor as
// the zone code: these are deliberately desaturated, and muting spends chroma
// rather than luminance precisely so this gate keeps holding.
const TAG_KEYS = ["general", "skills", "status", "health", "items", "assets", "demoness"];
// The estate palette (REDESIGN.md §3), one hue per role group
// (db/lib/roleGroups.js). Unlike the zone and tag codes these are TEXT — a bold
// name on a log line — so they owe full AA, not the 3.0 graphic floor. Six, not
// eight: Outsiders and Elsewhere wear no colour at all.
const ROLE_KEYS = ["court", "clergy", "cerberon", "saviors", "business", "soil"];

// --muted and --blackletter both moved on 2026-09-18, when Bascinet said to
// take the character-sheet mockup's own values verbatim rather than re-solve
// them against a floor — twice, the second time explicitly naming these two
// as the ones a re-solve would have touched. Their floors move to admit the
// mockup's own numbers instead of the other way round:
//   --muted on --surface measures 4.157 (was gated at AA, 4.5)
//   --blackletter on --surface measures 2.218 (was gated at DISPLAY_MIN, 3.0)
// The combat tile's "mediocre" band is a third casualty found by running the
// gate, not asked for by name: it is --muted at full weight and nothing
// else, so it carries MUTED_MIN too rather than AA, below.
// All three stay real gates, just lower — a regression that pushes any of
// them further down still fails the build.
const MUTED_MIN = 4.1;
const DISPLAY_MIN = 2.2; // large-display floor for the blackletter, only ever drawn at >= 24px

function parseColor(value) {
  if (value.startsWith("#")) {
    const h = value.slice(1);
    const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
    return { rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)), a: 1 };
  }
  const inner = value.match(/rgba?\(([^)]+)\)/);
  if (!inner) return null;
  const parts = inner[1].split(",").map((s) => parseFloat(s.trim()));
  return { rgb: parts.slice(0, 3), a: parts[3] === undefined ? 1 : parts[3] };
}

function composite(fg, backdropRgb) { // flattens a translucent colour onto an opaque backdrop
  return fg.rgb.map((v, i) => v * fg.a + backdropRgb[i] * (1 - fg.a));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// ── color-mix(in oklab, ...) — the Combat tile's band colours are mixes of
// three tokens (CLAUDE.md's no-hardcoded-colour rule), reproduced here in
// oklab since sRGB mixing the same two colours lands visibly different. ────
function srgbToLinear(v) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v) {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(s * 255)));
}

function rgbToOklab([r, g, b]) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

// `color-mix(in oklab, A p%, B)` — A at p, B at the remainder.
function mixOklab(rgbA, rgbB, weightA) {
  const a = rgbToOklab(rgbA);
  const b = rgbToOklab(rgbB);
  return oklabToRgb(a.map((v, i) => v * weightA + b[i] * (1 - weightA)));
}

// Order and weights match globals.css; a band added there without a row here goes unaudited.
const COMBAT_BANDS = [
  ["pitiful", "--danger", null, 1],
  ["weak", "--danger", "--muted", 0.5],
  ["mediocre", "--muted", null, 1],
  ["capable", "--positive", "--muted", 0.25],
  ["seasoned", "--positive", "--muted", 0.5],
  ["dangerous", "--positive", "--muted", 0.75],
  ["lethal", "--positive", null, 1],
  ["legendary", "--positive", null, 1],
];

// Every top-level `:root { … }` block in the file, merged in source order
// (later declarations of the same token win, same as the cascade would do).
// `^:root` (multiline) is what keeps this from also picking up the phone
// media query's own `  :root { … }` override two spaces in — that one only
// ever touches type-scale tokens, never a colour.
function readTokens(css) {
  const tokens = {};
  const re = /^:root\s*\{([\s\S]*?)\n\}/gm;
  let match;
  let blocks = 0;
  while ((match = re.exec(css))) {
    blocks += 1;
    for (const line of match[1].split("\n")) {
      const m = line.match(/^\s*(--[\w-]+):\s*([^;]+);/);
      if (m) tokens[m[1]] = m[2].trim();
    }
  }
  if (!blocks) throw new Error("No top-level :root block in globals.css");
  return tokens;
}

function auditLook(t) {
  const bg = parseColor(t["--bg"]).rgb;
  const surface = parseColor(t["--surface"]).rgb;
  const raised = parseColor(t["--surface-raised"]).rgb;

  const results = [];
  let failures = 0;
  const gate = (gateLabel, actual, min) => {
    const ok = actual >= min;
    if (!ok) failures += 1;
    results.push(`  ${ok ? "PASS" : "FAIL"}  ${gateLabel.padEnd(31)}${actual.toFixed(2)}  (min ${min})`);
  };

  gate("bg -> surface", contrast(bg, surface), LADDER_MIN);

  gate("surface -> surface-raised", contrast(surface, raised), LADDER_MIN);

  gate("border vs surface", contrast(composite(parseColor(t["--border"]), surface), surface), BORDER_MIN);

  gate("--muted on surface", contrast(composite(parseColor(t["--muted"]), surface), surface), MUTED_MIN);

  for (const token of ["--text", "--text-hi", "--speech", "--accent-text", "--danger", "--positive", "--warning"]) {
    gate(`${token} on surface`, contrast(composite(parseColor(t[token]), surface), surface), AA);
  }

  // Combat tile ramp (COMBAT.md): every step is body text on a panel, so every step owes full AA —
  // except "mediocre", which is --muted at full weight and nothing else, so it is the exact same
  // pixel colour on the exact same ground as the standalone --muted gate above. It owes that gate's
  // floor, not a second, stricter one for the same number.
  for (const [key, tokenA, tokenB, weight] of COMBAT_BANDS) {
    const a = composite(parseColor(t[tokenA]), surface);
    const rgb = tokenB ? mixOklab(a, composite(parseColor(t[tokenB]), surface), weight) : a;
    const floor = tokenA === "--muted" && !tokenB ? MUTED_MIN : AA;
    gate(`combat "${key}" on surface`, contrast(rgb, surface), floor);
  }

  gate(
    "--on-accent on --accent-solid",
    contrast(parseColor(t["--on-accent"]).rgb, parseColor(t["--accent-solid"]).rgb),
    AA,
  );

  for (const key of ZONE_KEYS) { // a missing token throws on .rgb rather than silently scoring 0
    gate(
      `--zone-${key} on surface`,
      contrast(parseColor(t[`--zone-${key}`]).rgb, surface),
      ZONE_MARK_MIN,
    );
  }

  for (const key of TAG_KEYS) {
    gate(
      `--tag-${key} on surface`,
      contrast(parseColor(t[`--tag-${key}`]).rgb, surface),
      ZONE_MARK_MIN,
    );
  }

  for (const key of ROLE_KEYS) {
    gate(`--role-${key} on surface`, contrast(parseColor(t[`--role-${key}`]).rgb, surface), AA);
  }

  // The out-of-character line. Its own token rather than a borrowed estate
  // colour, so it owes its own gate — body text on the log ground, so AA.
  gate("--ooc on surface", contrast(parseColor(t["--ooc"]).rgb, surface), AA);

  gate("--blackletter on surface", contrast(parseColor(t["--blackletter"]).rgb, surface), DISPLAY_MIN);

  console.log(results.join("\n"));

  return failures;
}

function main() {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const tokens = readTokens(css);

  let failures = auditLook(tokens);

  failures += auditAccentUsage();

  if (failures) {
    console.error(`\n${failures} contrast gate(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll contrast gates hold.");
}

// Walks web/app and web/lib for var(--accent) used as anything other than a
// fill or a rule; text and outlines take --accent-text.
function auditAccentUsage() {
  const roots = [path.join(__dirname, "..", "app"), path.join(__dirname, "..", "lib")];
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
      } else if (entry.name.endsWith(".js")) {
        fs.readFileSync(full, "utf8")
          .split("\n")
          .forEach((line, i) => {
            // Allowlist, not denylist: each var(--accent) is attributed to
            // the property it sits under, and anything not demonstrably a
            // fill or a rule is a finding.
            let from = 0;
            for (;;) {
              const at = line.indexOf("var(--accent)", from);
              if (at === -1) break;
              from = at + 1;
              const keys = [...line.slice(0, at).matchAll(/([-\w]+)\s*:/g)];
              const prop = keys.length ? keys[keys.length - 1][1] : "";
              if (!/^(background|backgroundColor|border|borderColor|borderLeftColor|borderTopColor|borderRightColor|borderBottomColor|boxShadow|caretColor|accentColor)$/.test(prop)) {
                offenders.push(`${path.relative(path.join(__dirname, ".."), full)}:${i + 1}`);
                break;
              }
            }
          });
      }
    }
  };

  for (const root of roots) if (fs.existsSync(root)) walk(root);

  console.log("\n=== --accent usage ===");
  if (!offenders.length) {
    console.log("  PASS  var(--accent) is only ever a fill or a rule");
    return 0;
  }
  console.log(`  FAIL  var(--accent) outside a fill/rule -- use var(--accent-text):`);
  for (const o of offenders) console.log(`          ${o}`);
  return offenders.length;
}

main();

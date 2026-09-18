// WCAG AA gate for the design tokens in web/app/globals.css (`npm run
// audit:contrast --workspace=web`). Parses token values straight out of the
// stylesheet so it can never drift. Two rules people break by accident: the
// surface ladder (--bg -> --surface -> --surface-raised must keep a step of
// separation), and --accent vs --accent-text (text and outlines must
// use --accent-text; --accent is a fill only). The zone code (--zone-*) is
// fills only too, gated at 3.0 against --surface, not AA.

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
// The name palette (REDESIGN.md §3), one hue per character. Unlike the zone
// and tag codes these are TEXT — a bold name on a log line — so they owe full
// AA, not the 3.0 graphic floor.
const NAME_KEYS = ["1", "2", "3", "4", "5", "6"];
// Large-display floor for the blackletter, which is only ever drawn at >= 24px.
const DISPLAY_MIN = 3.0;

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

// `readTokens(css, '[data-theme="dusk"]')` — a selector, not a theme name, so
// the lamp ramp's own [data-theme] block is read by the same parser.
function readTokens(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The bare `[data-theme]` selector must not also match `[data-theme="dusk"]`
  // or `[data-theme="dawn"]` — hence the negative lookahead on `=` right after
  // the escaped selector, before the optional whitespace and the `{`.
  const block = css.match(new RegExp(`${escaped}(?!=)\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`No ${selector} block in globals.css`);
  const tokens = {};
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*(--[\w-]+):\s*([^;]+);/);
    if (m) tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

// `color-mix(in srgb, A p%, B)` — component-wise on non-linear sRGB, which is
// what the browser does for an `in srgb` mix of two opaque colours. This one
// reproduces globals.css's lamp ramp; mixOklab above is the Combat tile's.
function mixSrgb(rgbA, rgbB, weightA) {
  return rgbA.map((v, i) => Math.round(v * weightA + rgbB[i] * (1 - weightA)));
}

// The six tokens the daytime gradient moves (REDESIGN.md §4), and the only
// ones. A seventh added to globals.css without a name here goes unaudited on
// the ramp, which is what assertRampWiring below exists to catch.
const RAMP_TOKENS = ["bg", "surface", "surface-raised", "border", "text", "speech"];

// The sweep. 0 and 1 are the ends; 0.5 is the midpoint REDESIGN.md §4 asks
// for. The range deliberately runs past clockTheme.js's LAMP_MAX of 0.6 and
// all the way to 1, so raising LAMP_MAX later cannot walk the app into an
// unaudited mix, and so this script needs no copy of that constant.
const LAMP_STEPS = [0, 0.25, 0.5, 0.75, 1];

// The CSS and the model above have to stay in step: this script computes the
// mix itself rather than resolving var() and color-mix() out of the
// stylesheet, so it has to be sure the stylesheet is still shaped that way.
function assertRampWiring(dusk, dawn) {
  const problems = [];
  for (const name of RAMP_TOKENS) {
    if (dusk[`--${name}`] !== `var(--dusk-${name})`) {
      problems.push(`[data-theme="dusk"] --${name} should read exactly var(--dusk-${name})`);
    }
    if (!(dawn[`--${name}`] || "").startsWith(`color-mix(in srgb, var(--dawn-${name})`)) {
      problems.push(`[data-theme="dawn"] --${name} should be a color-mix(in srgb, var(--dawn-${name}) …) of the ramp`);
    }
  }
  return problems;
}

// Lifted out of main() so it can run once for dusk (flat) and once per lamp
// step for dawn — see main(). `terse` collapses a pass to one line so the
// gradient's five intermediate steps don't each print a full table; the
// margin recorded is a step's tightest ratio to its own floor.
function auditLook(label, t, { terse } = {}) {
  const bg = parseColor(t["--bg"]).rgb;
  const surface = parseColor(t["--surface"]).rgb;
  const raised = parseColor(t["--surface-raised"]).rgb;

  const results = [];
  const margins = [];
  let failures = 0;
  const gate = (gateLabel, actual, min) => {
    const ok = actual >= min;
    if (!ok) failures += 1;
    margins.push({ label: gateLabel, margin: actual / min });
    results.push(`  ${ok ? "PASS" : "FAIL"}  ${gateLabel.padEnd(31)}${actual.toFixed(2)}  (min ${min})`);
  };

  gate("bg -> surface", contrast(bg, surface), LADDER_MIN);

  gate("surface -> surface-raised", contrast(surface, raised), LADDER_MIN);

  gate("border vs surface", contrast(composite(parseColor(t["--border"]), surface), surface), BORDER_MIN);

  for (const token of ["--text", "--muted", "--speech", "--accent-text", "--danger", "--positive", "--warning"]) {
    gate(`${token} on surface`, contrast(composite(parseColor(t[token]), surface), surface), AA);
  }

  // Combat tile ramp (COMBAT.md): every step is body text on a panel, so every step owes full AA.
  for (const [key, tokenA, tokenB, weight] of COMBAT_BANDS) {
    const a = composite(parseColor(t[tokenA]), surface);
    const rgb = tokenB ? mixOklab(a, composite(parseColor(t[tokenB]), surface), weight) : a;
    gate(`combat "${key}" on surface`, contrast(rgb, surface), AA);
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

  for (const key of NAME_KEYS) {
    gate(`--name-${key} on surface`, contrast(parseColor(t[`--name-${key}`]).rgb, surface), AA);
  }

  gate("--blackletter on surface", contrast(parseColor(t["--blackletter"]).rgb, surface), DISPLAY_MIN);

  if (!terse || failures) {
    console.log(`\n=== ${label} ===`);
    console.log(results.join("\n"));
  } else {
    const tightest = margins.reduce((min, m) => (m.margin < min.margin ? m : min));
    console.log(`\n=== ${label} ===`);
    console.log(`  PASS  ${margins.length} gates, tightest ${tightest.label} at ${tightest.margin.toFixed(2)}x its floor`);
  }

  return failures;
}

function main() {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const ramp = readTokens(css, "[data-theme]");
  const dusk = readTokens(css, '[data-theme="dusk"]');
  const dawn = readTokens(css, '[data-theme="dawn"]');

  const problems = assertRampWiring(dusk, dawn);
  if (problems.length) {
    console.error("\nThe lamp ramp in globals.css no longer matches this script's model:");
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }

  // Each look this script gates: dusk flat, then dawn at every step of the
  // day's gradient. A look is its block's tokens with the six ramp tokens
  // overwritten by the mix at that lamp value, so the STATIC tokens are
  // re-checked against the MIXED surface at every step — which is the point.
  // The dusk block's --bg etc. now read var(--dusk-bg), so they're resolved
  // from the ramp block too, or parseColor would choke on `var(...)`.
  const duskResolved = { ...dusk };
  for (const name of RAMP_TOKENS) duskResolved[`--${name}`] = ramp[`--dusk-${name}`];

  const looks = [{ label: "dusk", tokens: duskResolved }];
  for (const lamp of LAMP_STEPS) {
    const tokens = { ...dawn };
    for (const name of RAMP_TOKENS) {
      const a = parseColor(ramp[`--dawn-${name}`]).rgb;
      const b = parseColor(ramp[`--dusk-${name}`]).rgb;
      tokens[`--${name}`] = `#${mixSrgb(a, b, 1 - lamp).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    }
    looks.push({ label: `dawn (lamp ${lamp.toFixed(2)})`, tokens, terse: lamp !== 0 && lamp !== 1 });
  }

  let failures = 0;
  for (const look of looks) failures += auditLook(look.label, look.tokens, { terse: look.terse });

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

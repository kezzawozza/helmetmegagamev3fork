// What a Room overhears of a Conversation. Pure, for bot/src/lib/whisperPoll.js. A
// whisper is a 15-min PERIOD, so this samples runs at random (db/lib/muffle.js garbles letters instead, for the shout).

const { muffle } = require("./muffle");

// Heavier than a shout's last ring (0.4, db/lib/shout.js).
const LEAK_MUFFLE = 0.65;

const FRAGMENT_MIN_WORDS = 4;
const FRAGMENT_MAX_WORDS = 10;

// A single-token message with no `/\s+/` split would hand back the whole thing otherwise.
const FRAGMENT_MAX_CHARS = 90;
const LEAK_MAX_CHARS = 600;

// CJK/Thai count as ONE word, so the word window never bites; a character window stands in instead.
const CHAR_WINDOW_MIN = 12;
const CHAR_WINDOW_MAX = 30;

// Caps one message's weight so pasting a wall of text can't drown the pool.
const MESSAGE_WEIGHT_CAP = 80;

// Joined AFTER muffling, so the ellipsis never turns into static itself.
const SEPARATOR = " … ";

// Fragment count by words said in the window; each threshold crossed adds one.
const LADDER = [80, 200, 450, 900, 1800];

function fragmentCountFor(totalWords) {
  if (!(totalWords > 0)) return 0;
  const tier = LADDER.findIndex((ceiling) => totalWords < ceiling);
  return tier === -1 ? LADDER.length + 1 : tier + 1;
}

// Mentions/custom emoji come out BEFORE sampling — a surviving `<@id>` would ping a real person out of a leak.
const MENTION = /<[@#!&:a-zA-Z]?[^<>]*>/g;

// A proxied attachment placeholder (bot/src/lib/proxy.js#attachmentPlaceholders) — nobody SAID that.
const PLACEHOLDER_LINE = /^\[(image|attachment)\]$/;

const MARKDOWN = /[*_~`|]/g;

function poolOf(texts) {
  const pool = [];
  for (const text of texts ?? []) {
    const raw = String(text ?? "")
      .split("\n")
      .filter((line) => !PLACEHOLDER_LINE.test(line.trim()))
      .join(" ");
    const words = raw
      .replace(MENTION, " ")
      .replace(MARKDOWN, "")
      .split(/\s+/)
      .filter(Boolean);
    if (words.length) pool.push(words);
  }
  return pool;
}

const weightOf = (words) => Math.min(words.length, MESSAGE_WEIGHT_CAP);

function pickMessage(pool, totalWeight, rng) {
  let roll = rng() * totalWeight;
  for (const words of pool) {
    roll -= weightOf(words);
    if (roll < 0) return words;
  }
  return pool[pool.length - 1];
}

// Trims to whole code points, so the character cap can never sever a surrogate pair.
function clampChars(text, max) {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join("");
}

function drawFragment(pool, totalWords, rng) {
  const words = pickMessage(pool, totalWords, rng);
  if (words.length <= FRAGMENT_MIN_WORDS) {
    const joined = words.join(" ");
    const points = Array.from(joined);
    if (points.length <= CHAR_WINDOW_MAX) return joined;
    const span = CHAR_WINDOW_MAX - CHAR_WINDOW_MIN + 1;
    const length = CHAR_WINDOW_MIN + Math.floor(rng() * span);
    const start = Math.floor(rng() * (points.length - length + 1));
    return points.slice(start, start + length).join("");
  }
  const span = FRAGMENT_MAX_WORDS - FRAGMENT_MIN_WORDS + 1;
  const length = Math.min(
    words.length,
    FRAGMENT_MIN_WORDS + Math.floor(rng() * span),
  );
  const start = Math.floor(rng() * (words.length - length + 1));
  return clampChars(words.slice(start, start + length).join(" "), FRAGMENT_MAX_CHARS);
}

// Bounded redraw, not a search — a one-message window gives up and repeats.
const REDRAWS = 12;

// `texts`: a speaker's messages in the window. Null means nothing to overhear.
function leakLine(texts, { rng = Math.random } = {}) {
  const pool = poolOf(texts);
  if (!pool.length) return null;

  // Capped weight, so pasted text can't inflate a quiet conversation.
  const totalWords = pool.reduce((sum, words) => sum + weightOf(words), 0);
  const count = fragmentCountFor(totalWords);
  if (!count) return null;

  const fragments = [];
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    let fragment = drawFragment(pool, totalWords, rng);
    for (let redraw = 0; redraw < REDRAWS && seen.has(fragment); redraw += 1) {
      fragment = drawFragment(pool, totalWords, rng);
    }
    seen.add(fragment);
    fragments.push(fragment);
  }

  const line = fragments.map((f) => muffle(f, LEAK_MUFFLE, rng)).join(SEPARATOR);
  // Belt and braces: already-clamped fragments, but a loosened cap must not
  // leave the room hearing nothing at all, name line included.
  return clampChars(line, LEAK_MAX_CHARS);
}

module.exports = {
  leakLine,
  fragmentCountFor,
  FRAGMENT_MIN_WORDS,
  FRAGMENT_MAX_WORDS,
  FRAGMENT_MAX_CHARS,
  MESSAGE_WEIGHT_CAP,
  SEPARATOR,
};

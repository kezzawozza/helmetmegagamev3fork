// The @ autocomplete's pure logic. Nothing here is stored — everything derives from `value` + `caret`.

export const MAX_QUERY = 32;

// The active "@query" ending at the caret, or null; never spans a space or newline.
export function findMentionQuery(text, caret) {
  if (typeof caret !== "number") return null;
  const upto = text.slice(0, caret);
  let i = upto.length - 1;
  while (i >= 0 && !/[\s@]/.test(upto[i])) i -= 1;
  if (i < 0 || upto[i] !== "@") return null;
  const before = i > 0 ? upto[i - 1] : ""; // '@' must START a word — blocks "name@example.com" and "@@"
  if (before && !/[\s([{"'‘“]/.test(before)) return null;
  const query = upto.slice(i + 1);
  if (query.length > MAX_QUERY) return null;
  return { start: i, end: caret, query };
}

// Prefix-on-any-word first, then substring, alphabetical after that.
export function rankRoster(roster, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return roster.slice(0, limit);
  const hits = [];
  for (const c of roster) {
    const name = c.name.toLowerCase();
    const rank = name.startsWith(q) ? 0 : name.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : name.includes(q) ? 2 : 3;
    if (rank < 3) hits.push({ c, rank });
  }
  // Sort a copy, never the caller's array — react-hooks/immutability is an error in this repo.
  return hits
    .sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map((h) => h.c);
}

// Splices `{char:<id>|<Name>} ` into `text` at the query's byte range; the name half freezes who was meant (db/lib/characterMentions.js).
export function insertMention(text, query, character) {
  const token = `{char:${character.id}${character.name ? `|${character.name}` : ""}} `;
  const next = text.slice(0, query.start) + token + text.slice(query.end);
  return { text: next, caret: query.start + token.length };
}

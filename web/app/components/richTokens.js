// The {kind:payload} inline-reference syntax, split from its rendering. Lives here to avoid an import cycle
// (RichText renders TagChip, which renders ChipText). remarkTokens.js parses the same syntax separately for
// Markdown, since a `g`-flag RegExp's mutable lastIndex can't be shared between exec loops.
export const TOKEN_SOURCE = "\\{(\\w+):([^}]+)\\}";

// Ordered parts: { text } for literal runs, { kind, payload, raw } for tokens. `raw` is what a caller renders
// when it can't resolve one — an unresolved reference should be visible, not silently dropped.
export function splitTokens(text) {
  const parts = [];
  let lastIndex = 0;

  for (const match of text.matchAll(new RegExp(TOKEN_SOURCE, "g"))) {
    if (match.index > lastIndex) parts.push({ text: text.slice(lastIndex, match.index) });
    const [raw, kind, payload] = match;
    parts.push({ kind, payload, raw, index: match.index });
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex) });

  return parts;
}

// Whether this text names this character. Web twin of db/lib/characterMentions.js#mentionsCharacter, kept here
// so a client store/component doesn't drag the db workspace into the bundle. Both spellings, since a mention
// carries the name it was sent under (`{char:<id>|<Name>}`) and only an older row is bare.
export function mentionsCharacter(text, characterId) {
  if (typeof text !== "string" || !characterId) return false;
  return text.includes(`{char:${characterId}}`) || text.includes(`{char:${characterId}|`);
}

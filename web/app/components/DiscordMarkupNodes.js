"use client";

// The non-time half of Discord's angle-bracket vocabulary, rendered. Governing rule (characterMentions.js /
// RichText.js): a row is FACE-NEUTRAL, so none of these ever prints a raw Discord id (PROXYING.md).

// `<@id>`, `<@!id>` and `<@&id>` all land here, reusing the unresolved {char:…} look on purpose.
export function DiscordMention({ children }) {
  return <span className="chat-mention chat-mention--unknown">{children}</span>;
}

// `<:name:id>` renders as its NAME, never as the CDN image.
export function DiscordEmoji({ children }) {
  return <span className="discord-emoji">{children}</span>;
}

// `@here` / `@everyone` — words stay (deleting changes the sentence) but muted: on the web this notifies nobody.
export function DiscordPing({ children }) {
  return <span className="discord-ping">{children}</span>;
}

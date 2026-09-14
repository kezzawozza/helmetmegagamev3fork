// House format for an ephemeral reply: `» *You're not here.*` — chevron marks a restated line,
// italics say the game is answering you. `respond()` puts every reply through here so call sites
// write plain sentences. Discord-only policy — the web must never import this.

function ephemeralLine(content, { components } = {}) {
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) return content;

  if (text.includes("\n")) return content; // multi-line is a READOUT, not a notice
  if (Array.isArray(components) && components.length > 0) return content; // a line above a picker is a PROMPT
  if (text.startsWith("»")) return content; // already formatted
  if (text.startsWith("-#")) return content; // subtext
  if (text.startsWith("*")) return content; // own markdown

  return `» *${text}*`;
}

module.exports = { ephemeralLine };

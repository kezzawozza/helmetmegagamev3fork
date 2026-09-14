// Player- and GM-authored text, defanged: `{` `}` so a description can never forge a rich token
// ({tag:…}/{resource:…} via richTokens.js), `@` since authored text travels into Discord mention
// parsing, and control characters. customCraft.js re-exports it for its existing callers.
// ZERO DEPENDENCIES, and it must stay that way — client components import this through customCraft.js;
// anything required here gets dragged into the browser bundle.

function cleanCustomText(raw, max) {
  if (typeof raw !== "string") return "";
  const printable = [...raw]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code < 32 || code === 127) return " ";
      return "{}@".includes(ch) ? " " : ch;
    })
    .join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, max).trim();
}

module.exports = { cleanCustomText };

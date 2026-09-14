// Makes the inside of a {kind:payload} token inert before anything parses it.
// Done HERE at render, not stored: stored text must keep matching
// web/lib/feedAccess.js's `{char:<id>|` query and db/lib/characterMentions.js#mentionsCharacter.

const TOKEN = /\{\w+:[^}]*\}/;

const CODE = /(`+)[\s\S]*?\1/; // a run of backticks and whatever it closes over; nothing inside is escaped

const ACTIVE = /[\\*_`~[\]<|]/g; // backslash first, so escaping is idempotent

const escapeOne = (token) => token.replace(/\\(.)/g, "$1").replace(ACTIVE, "\\$&");

// Tries a token BEFORE a code run at each position, since the two can overlap and the token must win.
export default function escapeTokenSyntax(content) {
  if (typeof content !== "string" || !content.includes("{")) return content;

  const token = new RegExp(TOKEN.source, "y");
  const code = new RegExp(CODE.source, "y");
  let out = "";
  let at = 0;

  while (at < content.length) {
    token.lastIndex = at;
    const found = token.exec(content);
    if (found) {
      out += escapeOne(found[0]);
      at += found[0].length;
      continue;
    }

    code.lastIndex = at;
    const literal = code.exec(content);
    if (literal) {
      out += literal[0];
      at += literal[0].length;
      continue;
    }

    out += content[at];
    at += 1;
  }

  return out;
}

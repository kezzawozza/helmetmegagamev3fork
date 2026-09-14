// Making the inside of a {kind:payload} token inert, before anything parses it. A token's payload is `[^}]+`, so
// live Markdown inside one (e.g. `Bob *the Blade* Marley`) gets the paragraph cut there and remarkTokens.js —
// which needs the whole `{…}` inside one text node — never matches it, leaving a raw `{char:cmtt…` visible.
// Every Markdown-active character inside a token is escaped so the paragraph is never cut there at all.
// Done HERE at render, not by writing escapes into the row: what is STORED has to keep matching the visibility
// query in web/lib/feedAccess.js (a Prisma `contains` on `{char:<id>|`, CHAT.md §5) and its JS twin
// db/lib/characterMentions.js#mentionsCharacter. No imports, so db/test/chatFormatting.test.js loads it with no build step.

const TOKEN = /\{\w+:[^}]*\}/;

// A run of backticks and whatever it closes over — an inline code span, and a
// fenced block too, since both are "a run of N backticks, then the same run
// again". Nothing inside one is escaped: a `{char:…|Ada}` written between
// backticks is somebody showing the syntax, and a backslash in front of the bar
// would be visible in what they are showing. (A four-space indented block is
// not recognised, which is a fair price — nobody writes one in a chat line.)
const CODE = /(`+)[\s\S]*?\1/;

// Every character that can begin a Markdown construct inside a run of text.
// `<` is in the set because `<b>` is raw inline HTML and `[` because `[x](y)`
// is a link; the rest are the emphasis, code and strikethrough marks. The
// backslash is first so escaping is idempotent — a token already escaped ends
// up exactly as it started, which matters because nothing guarantees this runs
// only once.
const ACTIVE = /[\\*_`~[\]<|]/g;

const escapeOne = (token) => token.replace(/\\(.)/g, "$1").replace(ACTIVE, "\\$&");

// Walked once, trying a token at each position BEFORE a code run, because the
// two can overlap and the token has to win: `{info:costs `5` gold}` holds a
// backtick pair of its own, and treating that as a code span would leave the
// token unescaped and cut in half — the exact bug this file exists to stop.
// A code run only gets its exemption when it STARTS outside a token, which is
// what somebody demonstrating the syntax actually types.
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

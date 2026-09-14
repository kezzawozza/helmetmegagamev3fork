// House format for a line the WORLD says into a channel (a gate crossing, a smell, a whisper, the
// intercom): Discord's `-#` subtext, so scenery doesn't compete with player prose. `-#` is PER LINE —
// a multi-line block needs the prefix on every line, or everything after the first renders full size.

// `lines` are quoted extras that take a `»` inside the subtext. `signed` does nothing (accepted for compat).
function ambientLine(text, lines = [], { signed = true } = {}) {
  // Split on newlines so a multi-line `text` doesn't render its second half at full size.
  const body = [
    ...String(text).split("\n").map((l) => `-# ${l}`),
    ...lines.map((l) => `-# » ${l}`),
  ];
  void signed;
  return body.join("\n");
}

module.exports = { ambientLine };

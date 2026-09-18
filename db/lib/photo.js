// What a photograph shows, as one line of prose. Pure — no prisma, no I/O —
// same posture as db/lib/examine.js, its input source. A photo is an Examine
// that stopped moving: frozen onto a Tag row forever, however the subject
// changes afterwards. See docs/systemdocs/PORTRAITS.md for the avatar side
// of a face, which this deliberately does not touch.

// A photo is a THING: says what it shows in one breath, not labelled fields.
function joinBits(bits) {
  return bits.filter(Boolean).join(" · ");
}

// From an examineReadout() result. The concealed branch is the readout's own
// — a hood in a photograph is still a hood.
function photoCaption(readout) {
  if (readout.concealed) {
    return `${readout.line} ${joinBits([...readout.ailments, ...readout.equipment])}`.trim();
  }

  const appearance = readout.appearance || "Nothing you can make out.";
  // The office rides along, so the prose frozen onto the Tag says what the
  // modal says. Null for a hood and for a seat nobody reads off a look, both
  // decided once in db/lib/examine.js.
  const bits = joinBits([readout.roleTitle, ...readout.tags.map((t) => t.name)]);
  return [appearance, bits].filter(Boolean).join(" ");
}

// `Photo (Young Man)`. Subject in the NAME, not just description — the name
// is the only thing an inventory list, a stash and a Transfer dialog show.
function photoName(subject) {
  return `Photo (${subject})`;
}

module.exports = { photoCaption, photoName };

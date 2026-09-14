// syncZones Bodies: the text bodies for a Room's starter post and a
// Location's pinned anchor. Split out of db/lib/syncZones.js — see that file.
const { liveLine } = require("../roomLive");

// --- Bodies ------------------------------------------------------------

function italicParagraphs(text) {
  // Italic markup doesn't survive a blank line, so each paragraph wraps on
  // its own.
  return (text || "")
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph) => `*${paragraph.trim()}*`)
    .join("\n\n");
}

// `liveState` is the loaded state for room.live, or undefined. The live line
// joins the description's LAST paragraph with a pipe rather than standing on
// its own — it is a fact about the room, not a second post stapled under it.
function buildRoomBody(room, liveState) {
  const parts = [`**${room.name}**`];
  const description = italicParagraphs(room.description);
  const live = liveLine(room.live, liveState);
  if (description) parts.push(live ? `${description} | ${live}` : description);
  else if (live) parts.push(live);
  // A standing fact about the room, not scenery like the description — its
  // own line, the way locationAttributes.js keeps each fact separate rather
  // than folding it into prose.
  if (room.soundproof) parts.push("**Muffled**: shouts do not carry out of here.");
  // One newline, not two. A blank line between the bolded name and its `-#`
  // subtext reads as two separate posts stapled together; tight, the anchor
  // reads as one card.
  return parts.join("\n");
}

// The pinned anchor: name, -# description, and the Public Rooms index as
// thread mentions. Private rooms are deliberately absent — they're what the
// Secret rooms? button is for.
function buildAnchorBody(location, rooms) {
  const parts = [`**${location.name}**`];
  const description = (location.description || "").trim();
  if (description) {
    parts.push(
      description
        .split(/\n{2,}/)
        .map((paragraph) => `-# ${paragraph.trim().replace(/\s*\n+\s*/g, " ")}`)
        .join("\n"),
    );
  }
  const publicRooms = rooms
    .filter((r) => r.kind === "PUBLIC" && r.discordThreadId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  parts.push(
    publicRooms.length > 0
      ? `**Public Rooms**: ${publicRooms.map((r) => `<#${r.discordThreadId}>`).join(" | ")}`
      : "**Public Rooms**: none",
  );
  // One newline, not two. A blank line between the bolded name and its `-#`
  // subtext reads as two separate posts stapled together; tight, the anchor
  // reads as one card.
  return parts.join("\n");
}

module.exports = {
  buildRoomBody,
  buildAnchorBody,
};

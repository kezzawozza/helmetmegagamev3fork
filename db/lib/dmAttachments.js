// Splits an inbound player DM's Discord attachments (bot/src/events/messageCreate.js). An image rides
// to the GM desk inline via meta (web/app/components/DmThread.js#AttachedImages) — the raw Discord CDN
// url, reused as-is, no re-hosting, so it goes stale whenever Discord's signed url expires (~24h).
// Anything else stays the old text placeholder. Duck-typed on {name, url, contentType, width, height}
// rather than discord.js's Attachment class, so a test can hand it plain objects.

function isImageAttachment(a) {
  return Boolean(a?.contentType?.startsWith("image/"));
}

// `attachments` is anything iterable of attachment-shaped objects — message.attachments.values() from
// discord.js, or a plain array in a test.
function splitAttachments(attachments) {
  const list = [...(attachments ?? [])];
  const images = list.filter(isImageAttachment).map((a) => ({
    name: a.name ?? null,
    url: a.url,
    contentType: a.contentType ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
  }));
  const otherNames = list.filter((a) => !isImageAttachment(a)).map((a) => a.name);
  return { images, otherNames };
}

// The text half of an inbound DM. A caption and a non-image attachment now both survive in one
// message — the old inline version kept only the caption when both were present, silently dropping
// the attachment placeholder.
function buildInboundContent(text, otherNames) {
  const parts = [];
  if (text) parts.push(text);
  if (otherNames.length) parts.push(`*(attachment: ${otherNames.join(", ")})*`);
  return parts.join("\n\n");
}

module.exports = { isImageAttachment, splitAttachments, buildInboundContent };

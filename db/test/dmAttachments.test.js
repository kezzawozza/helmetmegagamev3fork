// Splitting an inbound player DM's attachments into images vs everything
// else (db/lib/dmAttachments.js), and the text half that survives alongside
// them (bot/src/events/messageCreate.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { isImageAttachment, splitAttachments, buildInboundContent } = require("../lib/dmAttachments");

const IMAGE = { name: "image.png", url: "https://cdn.discordapp.com/a/image.png", contentType: "image/png", width: 10, height: 10 };
const PDF = { name: "file.pdf", url: "https://cdn.discordapp.com/a/file.pdf", contentType: "application/pdf" };

test("isImageAttachment reads the contentType, not the filename", () => {
  assert.equal(isImageAttachment(IMAGE), true);
  assert.equal(isImageAttachment(PDF), false);
  assert.equal(isImageAttachment({ name: "image.png" }), false); // no contentType at all
  assert.equal(isImageAttachment(null), false);
});

test("splitAttachments separates images from everything else", () => {
  assert.deepEqual(splitAttachments([]), { images: [], otherNames: [] });
  assert.deepEqual(splitAttachments(undefined), { images: [], otherNames: [] });

  const { images, otherNames } = splitAttachments([IMAGE, PDF]);
  assert.deepEqual(images, [{ name: "image.png", url: IMAGE.url, contentType: "image/png", width: 10, height: 10 }]);
  assert.deepEqual(otherNames, ["file.pdf"]);
});

test("two identically-named images both survive as two separate entries", () => {
  const { images } = splitAttachments([IMAGE, IMAGE]);
  assert.equal(images.length, 2);
});

test("buildInboundContent: caption alone", () => {
  assert.equal(buildInboundContent("hello", []), "hello");
});

test("buildInboundContent: a non-image attachment alone", () => {
  assert.equal(buildInboundContent("", ["file.pdf"]), "*(attachment: file.pdf)*");
});

test("buildInboundContent: caption AND a non-image attachment both survive", () => {
  // The bug this fixes: the old inline code kept only the caption here.
  assert.equal(buildInboundContent("here's the form", ["file.pdf"]), "here's the form\n\n*(attachment: file.pdf)*");
});

test("buildInboundContent: an image-only message with no caption is empty text", () => {
  // The image itself rides in meta.attachments, not content — an image-only
  // DM leaves nothing for MarkdownContent to render.
  assert.equal(buildInboundContent("", []), "");
});

test("buildInboundContent: multiple non-image attachments are comma-joined", () => {
  assert.equal(buildInboundContent("", ["a.pdf", "b.txt"]), "*(attachment: a.pdf, b.txt)*");
});

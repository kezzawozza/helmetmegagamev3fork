// db/lib/locationMove.js#announceLevelFor: what the destination zone's
// #summary is told about somebody walking in. Stealth moves the announcement
// down ONE step rather than switching it off — a manned gate must not go silent.
const test = require("node:test");
const assert = require("node:assert/strict");
const { announceLevelFor } = require("../lib/locationMove");

const stealthy = [{ tag: { slug: "stealth" } }];
const ordinary = [{ tag: { slug: "clumsy" } }];

test("an ordinary traveller is announced exactly as the gate says", () => {
  assert.equal(announceLevelFor("TRUE_NAME", ordinary), "TRUE_NAME");
  assert.equal(announceLevelFor("CONCEALED", ordinary), "CONCEALED");
  assert.equal(announceLevelFor("NONE", ordinary), "NONE");
});

test("Stealth empties an unmanned gate: nobody was watching", () => {
  assert.equal(announceLevelFor("CONCEALED", stealthy), "NONE");
});

test("Stealth does NOT beat a manned gate, it only takes the name off", () => {
  assert.equal(announceLevelFor("TRUE_NAME", stealthy), "CONCEALED");
});

test("a gate that announces nothing cannot announce less", () => {
  assert.equal(announceLevelFor("NONE", stealthy), "NONE");
});

test("the tag list is read defensively", () => {
  assert.equal(announceLevelFor("CONCEALED"), "CONCEALED");
  assert.equal(announceLevelFor("CONCEALED", []), "CONCEALED");
  assert.equal(announceLevelFor("CONCEALED", [{ slug: "stealth" }]), "NONE");
  assert.equal(announceLevelFor("CONCEALED", [null]), "CONCEALED");
});

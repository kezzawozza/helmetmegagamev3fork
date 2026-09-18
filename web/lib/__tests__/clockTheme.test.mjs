import test from "node:test";
import assert from "node:assert/strict";
import { LAMP_MAX, chicagoMinutes, lookAt, resolveLook } from "../clockTheme.js";

const at = (iso) => lookAt(new Date(iso));

test("summer, CDT (UTC-5)", () => {
  assert.equal(chicagoMinutes(new Date("2026-07-01T11:00:00Z")), 6 * 60);
  assert.deepEqual(at("2026-07-01T11:00:00Z"), { theme: "dawn", lamp: 0 });       // 06:00
  assert.deepEqual(at("2026-07-01T17:00:00Z"), { theme: "dawn", lamp: 0.3 });     // 12:00, midday
  assert.deepEqual(at("2026-07-01T22:59:00Z"), { theme: "dawn", lamp: 0.599 });   // 17:59
  assert.deepEqual(at("2026-07-01T23:00:00Z"), { theme: "dusk", lamp: 1 });       // 18:00, the hard switch
  assert.deepEqual(at("2026-07-01T05:00:00Z"), { theme: "dusk", lamp: 1 });       // 00:00, overnight
});

test("winter, CST (UTC-6)", () => {
  assert.deepEqual(at("2026-01-15T11:59:00Z"), { theme: "dusk", lamp: 1 });       // 05:59
  assert.deepEqual(at("2026-01-15T12:00:00Z"), { theme: "dawn", lamp: 0 });       // 06:00
});

test("the DST boundaries move with the zone, not with UTC", () => {
  assert.deepEqual(at("2026-03-08T07:00:00Z"), { theme: "dusk", lamp: 1 });       // 01:00 CST, spring forward day
  assert.deepEqual(at("2026-03-08T11:00:00Z"), { theme: "dawn", lamp: 0 });       // 06:00 CDT, same day
  assert.deepEqual(at("2026-11-01T11:00:00Z"), { theme: "dusk", lamp: 1 });       // 05:00 CST, fall back day
  assert.deepEqual(at("2026-11-01T12:00:00Z"), { theme: "dawn", lamp: 0 });       // 06:00 CST
});

test("the ramp rises once, never past LAMP_MAX", () => {
  let previous = -1;
  for (let minute = 6 * 60; minute < 18 * 60; minute += 5) {
    const iso = `2026-07-01T${String(Math.floor((minute + 300) / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00Z`;
    const { theme, lamp } = at(iso);
    assert.equal(theme, "dawn");
    assert.ok(lamp >= previous, `lamp fell at ${iso}`);
    assert.ok(lamp <= LAMP_MAX, `lamp passed LAMP_MAX at ${iso}`);
    previous = lamp;
  }
});

test("BASCINET_THEME pins the look and kills the gradient", () => {
  const noon = new Date("2026-07-01T17:00:00Z");
  assert.deepEqual(resolveLook("dusk", noon), { theme: "dusk", lamp: 1, pinned: true });
  assert.deepEqual(resolveLook("dawn", noon), { theme: "dawn", lamp: 0, pinned: true });
  assert.deepEqual(resolveLook("limestone", noon), { theme: "dawn", lamp: 0.3, pinned: false });
  assert.deepEqual(resolveLook(undefined, noon), { theme: "dawn", lamp: 0.3, pinned: false });
  assert.deepEqual(resolveLook(null, noon), { theme: "dawn", lamp: 0.3, pinned: false });
});

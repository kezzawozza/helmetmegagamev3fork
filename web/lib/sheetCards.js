// The sheet's tag rail, bucketed: which card a held tag goes in, how rows are ordered and
// sub-grouped, and the one value each row shows on its right. Pure functions over CharacterTag[].
// Status is deliberately absent: the band's StatusStrip carries those chips (SHEET.md).

import { turnsLeft, tagDuration } from "@lifeweb/db/lib/turnFormat";
import { armorWord } from "@lifeweb/db/lib/armorValue";
import { describeEquipFit } from "@lifeweb/db/lib/equipSlots";
import { tagWeightLbs, formatTagWeight } from "./formatTagWeight";

// The cards drawn as ITEM CARDS rather than compact rows — the two that are
// an inventory. Everything else (Health, Skills, General, Meta) keeps the
// one-line row, where a single right-hand value is the right amount to say.
export const INVENTORY_CARDS = new Set(["Items", "Assets"]);

// Status is not drawn by the sheet at all (its band's StatusStrip owns those
// chips), but it is FIRST for a surface that opts in: "is this person
// Catatonic" is the question a GM asks before any other.
const CARD_ORDER = ["Status", "Health", "Skills", "Items", "Assets", "General", "Meta", "Demoness"];

// Case-folded, and exported because thingRows.js needs the same rule: until the
// 2026-09-26 backfill the catalog genuinely held both "Items" and "items" (six
// runtime minters wrote the YAML slug instead of the display name). The rows
// are corrected now, but this stays as the belt to that migration's braces — a
// future minter that slips should look wrong in a picker, not silently vanish
// out of a bucket the way the Things drawer's exact match made it.
export function canonicalCategory(raw) {
  const trimmed = raw?.trim() || "Other";
  return CARD_ORDER.find((c) => c.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
}

function rank(category) {
  const i = CARD_ORDER.indexOf(category);
  return i === -1 ? CARD_ORDER.length : i;
}

function rowWeight(ct) {
  return tagWeightLbs(ct.tag, ct.quantity ?? 1);
}

// Signed percent for a carry bonus: Cart +4 reads "+400%", Frail −0.1 "−10%".
export function carryBonusLabel(bonus) {
  if (bonus == null || bonus === 0) return null;
  const pct = Math.round(bonus * 100);
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}% carry`;
}

// (LABORING.md §5)
function laborBonusLabel(laborBonus) {
  if (!laborBonus?.kind || !laborBonus?.amount) return null;
  return `+${laborBonus.amount} ${laborBonus.kind}`;
}

// { text, tone } — a clock beats a weight beats a stack count; tone "danger" on a tag's last turn.
export function rowValue(ct, currentTurn = null) {
  const tag = ct.tag;
  const left = turnsLeft(ct.expiresTurn, currentTurn);
  const duration = tagDuration(left, null);
  if (duration) return { text: duration.badge, tone: left === 1 ? "danger" : null };
  const weight = tagWeightLbs(tag, ct.quantity ?? 1);
  if (weight > 0) return { text: `${weight} lb`, tone: null };
  const armor = tag.ballisticArmor ?? tag.meleeArmor;
  if (armor) return { text: armorWord(Math.max(tag.meleeArmor ?? 0, tag.ballisticArmor ?? 0)), tone: null };
  const carry = carryBonusLabel(tag.carryBonus);
  if (carry) return { text: carry, tone: null };
  const labor = laborBonusLabel(tag.laborBonus);
  if (labor) return { text: labor, tone: null };
  if ((ct.quantity ?? 1) > 1) return { text: `×${ct.quantity}`, tone: null };
  return null;
}

// EVERY fact about a held row, in reading order — what an item card shows.
//
// rowValue() above answers "the one thing worth saying in a right-hand
// column", and that is right for a one-line row but lossy by construction: a
// stack of five 2 lb rations reads "10 lb" and never says there are five of
// them, and an armoured coat never mentions its armour because it happens to
// weigh something. A card has room for all of it, so it gets all of it.
//
// Returns [{ key, text, tone }]. Empty is a normal answer.
export function itemFacts(ct, currentTurn = null) {
  const tag = ct.tag;
  const quantity = ct.quantity ?? 1;
  const facts = [];

  const left = turnsLeft(ct.expiresTurn, currentTurn);
  const duration = tagDuration(left, null);
  if (duration) facts.push({ key: "duration", text: duration.badge, tone: left === 1 ? "danger" : null });

  const weight = formatTagWeight(tag, quantity);
  if (weight) facts.push({ key: "weight", text: weight, tone: null });

  // "2 of 5 worn" is the fact the compact row could never carry: `equipped`
  // is a boolean there, so a partly-equipped stack looked the same as a fully
  // equipped one. equippedQuantity has always been on the row (it is what
  // db/lib/equipSlots.js counts hands and layers by) — nothing read it.
  if (tag.equippable) {
    const out = ct.equippedQuantity ?? (ct.equipped ? 1 : 0);
    if (quantity > 1 && out > 0) facts.push({ key: "equipped", text: `${out} of ${quantity} worn`, tone: null });
    const fit = describeEquipFit(tag);
    if (fit) facts.push({ key: "fit", text: fit, tone: null });
  }

  const armor = Math.max(tag.meleeArmor ?? 0, tag.ballisticArmor ?? 0);
  if (armor) facts.push({ key: "armor", text: armorWord(armor), tone: null });

  const carry = carryBonusLabel(tag.carryBonus);
  if (carry) facts.push({ key: "carry", text: carry, tone: null });

  const labor = laborBonusLabel(tag.laborBonus);
  if (labor) facts.push({ key: "labor", text: labor, tone: null });

  return facts;
}

function healthOrder(a, b, currentTurn) {
  const la = turnsLeft(a.expiresTurn, currentTurn) ?? Infinity;
  const lb = turnsLeft(b.expiresTurn, currentTurn) ?? Infinity;
  return la - lb || a.tag.name.localeCompare(b.tag.name);
}

// Sub-groups by TagGroup, groupless last. Each { key, name, rows }.
// No colour: a group's mark is its ICON now (web/lib/tagIcons.js), and colour
// says which CATEGORY a tag is in — one signal each.
function byGroup(rows) {
  const groups = new Map();
  for (const ct of rows) {
    const key = ct.tag.group?.slug ?? "__other";
    if (!groups.has(key)) groups.set(key, { key, name: ct.tag.group?.name ?? null, rows: [] });
    groups.get(key).rows.push(ct);
  }
  const list = [...groups.values()];
  list.sort((a, b) => (a.key === "__other") - (b.key === "__other") || (a.name ?? "").localeCompare(b.name ?? ""));
  return list;
}

// `includeStatus` is for a surface with no StatusStrip above it. The sheet has
// one in its band, which is why Status is dropped here by default; the GM
// inspector's rail has nothing of the kind, and silently hiding Catatonic or
// Wanted from the person adjudicating is the opposite of the point.
export function buildCards(characterTags = [], { currentTurn = null, includeStatus = false } = {}) {
  const buckets = new Map();
  for (const ct of characterTags) {
    const category = canonicalCategory(ct.tag?.category);
    if (category === "Status" && !includeStatus) continue;
    if (!buckets.has(category)) buckets.set(category, []);
    buckets.get(category).push(ct);
  }

  const cards = [...buckets.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([category, rows]) => {
      if (category === "Health") {
        const sorted = [...rows].sort((a, b) => healthOrder(a, b, currentTurn));
        return { key: category, title: category, count: rows.length, groups: [{ key: "all", name: null, rows: sorted }] };
      }
      // Both inventory cards, treated alike. Assets used to fall through to
      // the plain branch below — no sub-groups and no weight total — even
      // though the rail grants it the same verbs as Items, so a character's
      // property was the one holding that could not be skimmed by kind.
      // Assets weigh nothing by rule (db/lib/tagWeight.js), so their total is
      // 0 and the header simply omits it.
      if (INVENTORY_CARDS.has(category)) {
        const groups = byGroup(rows).map((g) => ({
          ...g,
          rows: [...g.rows].sort((a, b) => rowWeight(b) - rowWeight(a) || a.tag.name.localeCompare(b.tag.name)),
        }));
        const weight = Math.round(rows.reduce((n, ct) => n + rowWeight(ct), 0) * 100) / 100;
        return { key: category, title: category, count: rows.length, groups, weight: weight > 0 ? weight : null };
      }
      if (category === "Skills") {
        const groups = byGroup(rows).map((g) => ({
          ...g,
          rows: [...g.rows].sort((a, b) => a.tag.name.localeCompare(b.tag.name)),
        }));
        return { key: category, title: category, count: rows.length, groups };
      }
      const sorted = [...rows].sort((a, b) => a.tag.name.localeCompare(b.tag.name));
      return { key: category, title: category, count: rows.length, groups: [{ key: "all", name: null, rows: sorted }] };
    });
  return cards;
}

// The catalog tag whose parentTagId is this one and not already held; null when the ladder ends here.
export function nextRung(ct, catalog = [], heldTagIds = new Set()) {
  return catalog.find((t) => t.parentTagId === ct.tag.id && !heldTagIds.has(t.id)) ?? null;
}

export function matchesQuery(ct, query) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    ct.tag.name.toLowerCase().includes(q) ||
    (ct.tag.description ?? "").toLowerCase().includes(q) ||
    (ct.tag.group?.name ?? "").toLowerCase().includes(q)
  );
}

// The pure half of pickpocketing (db/lib/pickpocket.js). Two things worth
// pinning: the three outcome bands, because the middle one (you get it AND they
// feel it) is the whole texture of the verb and is easy to collapse into a
// plain pass/fail by accident; and the holdings filter, where the Assets clause
// is a real hole rather than a nicety.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SKILLED_BONUS,
  BUDGET_LBS,
  SKILLED_BUDGET_LBS,
  CLEAN,
  NOTICED,
  FAILED,
  holdsPickpocket,
  isSkilled,
  pickpocketBonus,
  pickpocketBudgetLbs,
  pickpocketOutcome,
  pickpocketTook,
  pickpocketableHoldings,
  weighPicks,
} = require("../lib/pickpocket");

const held = (...slugs) => slugs.map((slug) => ({ tag: { slug } }));
const band = (die, tags = []) => pickpocketOutcome(die + pickpocketBonus(tags));

test("the three bands: 1 fails, 2-3 is noticed, 4+ is clean", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((d) => band(d)),
    [FAILED, NOTICED, NOTICED, CLEAN, CLEAN, CLEAN],
  );
});

test("both success bands take the goods; only a 1 takes nothing", () => {
  assert.equal(pickpocketTook(CLEAN), true);
  assert.equal(pickpocketTook(NOTICED), true);
  assert.equal(pickpocketTook(FAILED), false);
});

// "Almost always succeeds" is the claim the tag makes, and this is it: the +1
// lifts a natural 1 clear of the failure band, so a master is never caught
// empty-handed — only felt.
test("Skilled's +1 means a master never fails outright", () => {
  assert.equal(SKILLED_BONUS, 1);
  const master = held("pickpocket", "pickpocketing-skilled");
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((d) => band(d, master)), [
    NOTICED,
    NOTICED,
    CLEAN,
    CLEAN,
    CLEAN,
    CLEAN,
  ]);
});

test("the budget doubles for a master", () => {
  assert.equal(pickpocketBudgetLbs(held("pickpocket")), BUDGET_LBS);
  assert.equal(pickpocketBudgetLbs(held("pickpocket", "pickpocketing-skilled")), SKILLED_BUDGET_LBS);
  assert.equal(BUDGET_LBS, 15);
  assert.equal(SKILLED_BUDGET_LBS, 30);
});

test("either rung opens the verb; only the top one is skilled", () => {
  assert.equal(holdsPickpocket(held("pickpocket")), true);
  // A GM grant of the top rung alone still works — the catalog's requiredTag
  // is what normally puts both on a sheet, but this reads the pair, not the
  // invariant.
  assert.equal(holdsPickpocket(held("pickpocketing-skilled")), true);
  assert.equal(holdsPickpocket(held("stealth")), false);
  assert.equal(isSkilled(held("pickpocket")), false);
  assert.equal(pickpocketBonus(held("pickpocket")), 0);
});

const row = (over) => ({ quantity: 1, equipped: false, tag: { tradeable: true, category: "Items", weightLbs: 3 }, ...over });

test("what a hand can reach: tradeable, not worn, not an Asset", () => {
  assert.equal(pickpocketableHoldings([row()]).length, 1);
  // A skill or an injury was never cargo.
  assert.equal(pickpocketableHoldings([row({ tag: { tradeable: false, category: "Skills" } })]).length, 0);
  // Lifting a worn breastplate off a standing man is a fight, not a theft.
  assert.equal(pickpocketableHoldings([row({ equipped: true })]).length, 0);
  assert.equal(pickpocketableHoldings([row({ quantity: 0 })]).length, 0);
});

// The one that would be a hole rather than a nicety. An Asset weighs 0 on
// purpose (a horse carries itself, CARRY.md §1), so the weight budget — the
// only brake this verb has — cannot bound it. Without this clause 15 lb buys
// every horse, deed and house somebody has on them, unlimited.
test("Assets are off the table entirely, because the budget cannot measure them", () => {
  assert.equal(pickpocketableHoldings([row({ tag: { tradeable: true, category: "Assets", weightLbs: 0 } })]).length, 0);
  // Case-folded, matching tagWeight.js — the catalog has held both spellings.
  assert.equal(pickpocketableHoldings([row({ tag: { tradeable: true, category: "assets", weightLbs: 0 } })]).length, 0);
});

test("picks are weighed per unit, not per row", () => {
  const r = row({ quantity: 5 });
  assert.equal(weighPicks([{ held: r, quantity: 2 }]), 6);
  assert.equal(weighPicks([]), 0);
});

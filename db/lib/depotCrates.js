// Crates: what a shipment looks like when the shuttle sets it down — packed into a random number of crates that must be opened (worth paying a Docker for, delays "bought" from "holding", and leaves a crate on the landing pad crackable by whoever's there). A crate is a TAG, created at runtime with custom: true — db/lib/pruneTags.js already skips custom rows so db:prune-tags won't eat them, and being a tag gives crates carry weight, transfers, room stashes and theft for free. One Tag row per crate, swept once the last instance is gone. Manifest printed on the crate, Bascinet's format: `[SHIPMENT ID RV-4471-K]: Coal x 4 | Bandage x 6 | ML-23`, or `[SHIPMENT ID RV-4471-K]: SEALED` if anything in it ships sealed — only a Depot Keycard opens a sealed crate, and one sealed line item seals the whole crate, so nobody knows which crate the dangerous thing is in.

const { DEPOT_KEYCARD_SLUG } = require("./depotState");
const { PACKAGE_MAX_LBS, PACKAGE_MAX_UNITS } = require("./constants");

// A crated ⬢ weighs a pound, so ⬢ pack against the same weight rule as everything else and ride in a crate with other goods. Loose on a sheet they weigh nothing and count against carryResourceCap instead (docs/systemdocs/CARRY.md §1) — freight and sheet never double-count the same ⬢.
const RESOURCE_UNIT_LBS = 1;

// A crate weighs HALF what's in it — the same rule the player-facing Package button applies (docs/systemdocs/FACTORY.md), so a Depot shipment and a Banneret's wagon load obey one arithmetic. Rounded UP, never below 1: an empty-ish crate of weightless things is still a wooden box. See docs/systemdocs/CARRY.md for the ladder this sits on. `resources` defaults to 0 because the player-facing Package button calls this too (packageItemsRequestImpl), and a player crate can never hold ⬢.
function crateWeight(contents, weightByTagId, resources = 0) {
  const inner =
    (contents ?? []).reduce(
      (sum, line) => sum + (weightByTagId?.get?.(line.tagId) ?? 0) * (line.quantity ?? 1),
      0,
    ) + (resources ?? 0) * RESOURCE_UNIT_LBS;
  return Math.max(1, Math.ceil(inner / 2));
}

// A crate is a BOX: what fits is a question about weight, not how many things you counted. PACKAGE_MAX_LBS is the player Package button's cap, reused deliberately — FACTORY.md §5's one arithmetic for a Depot shipment and a hand-packed crate now covers the ceiling as well as the halving. PACKAGE_MAX_UNITS is the second cap, needed because the weight cap doesn't bound the weightless — eight Depot wares weigh 0 lb (paper, cigarettes, jewelry, spectacles, the four animals) — so without it a paper order packs into one crate however large.

// A shipment never becomes more crates than this, however large the order — otherwise a Merchant with 200 obols could bury the landing pad in tag rows.
const MAX_CRATES = 12;

const SHIPMENT_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";

// Something that reads like a real waybill number rather than a cuid: two letters for the run, four digits, a check letter. Collisions don't matter mechanically — the crate's slug carries a uniquifier — purely for the look of the thing.
function shipmentId(rng = Math.random) {
  const digits = String(Math.floor(rng() * 9000) + 1000);
  const check = SHIPMENT_LETTERS[Math.floor(rng() * SHIPMENT_LETTERS.length)];
  return `RV-${digits}-${check}`;
}

// Fisher-Yates on a copy. In its own function because getting this subtly wrong biases every shipment in the game and nobody would ever notice.
function shuffle(list, rng = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Manifest line items -> crates. `items` are `{ tagId, name, quantity, sealed }`; every unit is expanded and shuffled so a crate holds a random handful, and a crate holding any sealed unit becomes sealed. A line with no `tagId` is Resources — one ⬢ is one unit weighing RESOURCE_UNIT_LBS, mixed into the shuffle and lifted onto the crate as a plain number via the null-key aggregation below. Packing is by WEIGHT: units fill the open crate until one more would exceed PACKAGE_MAX_LBS or PACKAGE_MAX_UNITS, then a new crate opens — what makes a crate a box, not a counter. Returns `[{ sealed, resources, contents: [{ tagId, name, quantity }] }]`; total units out always equals total units in, since the Merchant has already paid for all of it.
function splitIntoCrates(items = [], { weightByTagId, rng = Math.random } = {}) {
  const units = [];
  for (const item of items) {
    const n = Math.max(0, Math.floor(item?.quantity ?? 0));
    const lbs =
      item?.tagId == null ? RESOURCE_UNIT_LBS : (weightByTagId?.get?.(item.tagId) ?? 0);
    for (let i = 0; i < n; i++) {
      units.push({ tagId: item.tagId ?? null, name: item.name, sealed: Boolean(item.sealed), lbs });
    }
  }
  if (!units.length) return [];

  const shuffled = shuffle(units, rng);

  // A huge order doesn't become a hundred crates — past MAX_CRATES the last one just keeps filling. Overfull beats burying the landing pad in rows.
  const slices = [];
  let current = null;
  for (const unit of shuffled) {
    const last = slices.length >= MAX_CRATES;
    const full =
      current &&
      !last &&
      // The first unit always goes in, whatever it weighs — without this, a ware heavier than the cap would never fit and the loop wouldn't terminate. Nothing in the catalog is that heavy today, but that's a fact about the data, not something to rest a loop on.
      (current.lbs + unit.lbs > PACKAGE_MAX_LBS ||
        current.units.length + 1 > PACKAGE_MAX_UNITS);
    if (!current || full) {
      current = { lbs: 0, units: [] };
      slices.push(current);
    }
    current.lbs += unit.lbs;
    current.units.push(unit);
  }

  return slices.map((slice) => {
    const byTag = new Map();
    let resources = 0;
    for (const unit of slice.units) {
      if (unit.tagId == null) {
        resources += 1;
        continue;
      }
      const row = byTag.get(unit.tagId);
      if (row) row.quantity += 1;
      else byTag.set(unit.tagId, { tagId: unit.tagId, name: unit.name, quantity: 1 });
    }

    return {
      sealed: slice.units.some((u) => u.sealed),
      resources,
      contents: [...byTag.values()],
    };
  });
}

function crateDescription(shipment, crate) {
  if (crate?.sealed) return `[SHIPMENT ID ${shipment}]: SEALED`;
  const parts = (crate?.contents ?? []).map((c) =>
    c.quantity > 1 ? `${c.name} x ${c.quantity}` : c.name,
  );
  if (crate?.resources > 0) parts.push(`Resources x ${crate.resources}`);
  return `[SHIPMENT ID ${shipment}]: ${parts.join(" | ")}`;
}

// Who may open this crate: a sealed one needs the keycard, an open one needs nothing since its manifest is printed on the side with no lock to pick. Takes held slugs as a Set, the shape roomAccess.js already builds.
function canOpenCrate(crateTag, heldSlugs) {
  if (!crateTag?.sealedShipping) return true;
  return Boolean(heldSlugs?.has?.(DEPOT_KEYCARD_SLUG));
}

// A crate's tag slug, server-generated with the "custom-" prefix every runtime tag uses (Tag.custom in schema.prisma), so it can never collide with a docs/tags.yaml slug and get upserted over by a sync.
function crateSlug(shipment, index) {
  return `custom-crate-${shipment.toLowerCase()}-${index + 1}`;
}

function crateName(shipment, index) {
  return `Crate ${shipment}·${index + 1}`;
}

// The Tag rows for one shipment. `contents` is stashed on the tag itself so opening it needs no shipment lookup — the crate is self-describing, which is also what lets one be carried off, traded, and opened elsewhere. groupId is the caller's, since db/lib/ must not read the catalog.
function crateTagData(shipment, crates, { groupId = null, weightByTagId = new Map() } = {}) {
  return crates.map((crate, index) => ({
    slug: crateSlug(shipment, index),
    name: crateName(shipment, index),
    description: crateDescription(shipment, crate),
    custom: true,
    // Game state, not catalog — a Restart Game sweeps it up. See TAGS.md §5d.
    ephemeral: true,
    category: "items",
    groupId,
    pointCost: 0,
    tradeable: true,
    stackable: false,
    weightLbs: crateWeight(crate.contents, weightByTagId, crate.resources),
    removable: true,
    sealedShipping: crate.sealed,
    // A crate is opened by CONSUMING it, the same verb as anything else on the sheet — no Open button on /depot. canOpenCrate below is still the gate, re-checked inside that consume path.
    consumable: true,
    consumesIntoResources: crate.resources > 0 ? crate.resources : null,
    crateContents: crate.contents,
  }));
}

module.exports = {
  RESOURCE_UNIT_LBS,
  shipmentId,
  splitIntoCrates,
  crateTagData,
  crateWeight,
  canOpenCrate,
};

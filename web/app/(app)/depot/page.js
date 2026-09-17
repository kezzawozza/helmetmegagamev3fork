import { redirect } from "next/navigation";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import DepotView from "./DepotView";
import Loading from "../Skeleton";
import {
  prisma,
  MERCHANT_LICENSE_SLUG,
  DEPOT_LOCATION_SLUG,
  DEPOT_KEYCARD_SLUG,
  COAL_SLUG,
  SALTPETER_SLUG,
  OBOL_SLUG,
  LANDING_PAD_SLUG,
  loadDepot,
  depotPowered,
  fuelTurnsLeft,
  creditAvailableObols,
  RESOURCE_IMPORT_PRICE,
  RESOURCE_EXPORT_PRICE,
  RESOURCE_WARE_ID,
  resourcesOf,
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  presentedIdentity,
  forcedNameFrom,
} from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { getOpenTurn } from "@/lib/turn";

// The Merchant's station. See docs/systemdocs/DEPOT.md.
//
// Three ways in, and they are deliberately different. The Merchant's Licence
// runs the place — the licence and not the ROLE, because the licence is
// tradeable and handing it over really does hand over the Depot. A Depot
// Keycard works it: a Docker can crack his crates, call the shuttle down,
// load it and send it back up, and keep the generator fed and running. What a
// keycard cannot do is spend: no ordering, no ATM, no credit line, no ⬢
// counter, and never the turret. A superadmin reads it. Everyone else is
// bounced.
//
// The reason the keycard grew teeth is the turn length. One turn is one real
// day, so "the Merchant will do it when he wakes up" is a day of nothing
// moving, and every step above is either free or costs the person doing it.
const TAG_SELECT = { include: { group: { select: { name: true } } } };

// How many ledger rows to hand the client. Enough to be a book, few enough
// that a month-old game does not ship a megabyte of JSON to a browser.
const LEDGER_LIMIT = 200;

// The ledger is built from the audit log now that player actions file no
// Request. The `details` blob IS the old `effect` — every depot action wrote
// `details: effect` — so the row prose below is unchanged; only the key it
// switches on moved from Request.type to AuditLog.actionType.
const DEPOT_LEDGER_KINDS = {
  request_depot_order: { key: "DEPOT_ORDER", label: "Order" },
  request_depot_shuttle_call: { key: "DEPOT_SHIP", label: "Shuttle" },
  request_depot_shuttle_send: { key: "DEPOT_SHIP", label: "Shuttle" },
  request_depot_atm: { key: "DEPOT_ATM", label: "Cash" },
  request_depot_credit: { key: "DEPOT_CREDIT", label: "Credit line" },
  request_depot_crate_open: { key: "DEPOT_CRATE_OPEN", label: "Crate" },
  request_depot_refuel: { key: "DEPOT_REFUEL", label: "Refuel" },
};

// One line of prose per ledger row, and the obols it moved. Derived from the
// `effect` snapshot rather than live state, the same rule Undo follows — a row
// has to keep reading correctly after the catalog moves under it.
function ledgerRow(entry, who) {
  const e = entry.details ?? {};
  switch (DEPOT_LEDGER_KINDS[entry.actionType]?.key) {
    case "DEPOT_ORDER":
      return { detail: (e.lines ?? []).map((l) => `${l.name} ×${l.quantity}`).join(", "), delta: -(e.total ?? 0) };
    case "DEPOT_SHIP":
      return e.direction === "UP"
        ? { detail: `Sent up ${(e.soldTags ?? []).length} lot(s)${e.resourcesSpent ? ` and ${e.resourcesSpent} ⬢` : ""}`, delta: e.payout ?? 0 }
        : { detail: `Shipment ${e.shipment ?? ""} — ${e.crates ?? 0} crate(s)`, delta: 0 };
    case "DEPOT_ATM":
      return { detail: e.direction === "WITHDRAW" ? "Withdrawn as coin" : "Deposited", delta: e.direction === "WITHDRAW" ? -(e.amount ?? 0) : (e.amount ?? 0) };
    case "DEPOT_CREDIT":
      return { detail: e.direction === "DRAW" ? "Drawn on the line" : "Repaid the line", delta: e.direction === "DRAW" ? (e.amount ?? 0) : -(e.amount ?? 0) };
    case "DEPOT_CRATE_OPEN":
      return { detail: `${e.crateName ?? "A crate"} — ${(e.granted ?? []).map((g) => `${g.name} ×${g.quantity}`).join(", ") || "empty"}`, delta: 0 };
    case "DEPOT_REFUEL":
      return { detail: `${e.tagName ?? "Fuel"} ×${e.quantity ?? 0} into the generator`, delta: 0 };
    default:
      return { detail: e.tagName ? `${e.tagName} ×${e.quantity ?? 1}` : "", delta: 0 };
  }
}

// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshDepot in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function DepotPage() {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  return (
    <SnapshotPage scope="depot" userId={session.discordUserId} render={DepotView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshDepot />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshDepot() {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      concealed: true,
      location: { select: { slug: true } },
      tags: {
        select: {
          quantity: true,
          tagId: true,
          equipped: true,
          tag: { select: { slug: true, forcedName: true, name: true, ...CONCEALMENT_TAG_FIELDS } },
        },
      },
    },
  });

  const heldSlugs = new Set((character?.tags ?? []).map((ct) => ct.tag.slug));
  const licensed = heldSlugs.has(MERCHANT_LICENSE_SLUG);
  const keycard = heldSlugs.has(DEPOT_KEYCARD_SLUG);
  const superadmin = isSuperadmin(session.discordUserId);

  if (!licensed && !keycard && !superadmin) redirect("/character");

  // Standing at the Depot is NOT required to open the page — only to work it.
  // It used to bounce you to /character, and a rail item that answers a click
  // by throwing you at a different page reads as a broken link rather than as
  // a rule. So the console opens from anywhere, greyed: `atDepot` below is
  // already in every control's gate, and DepotConsole leads with "You're not
  // at the depot." The server actions are the enforcement either way
  // (requireDepotStanding in ./actions.js), and they have not moved.

  const depot = await loadDepot(prisma);
  const openTurn = await getOpenTurn();

  const [wareTags, pricedTags, pad, obolTag, ledgerRows] = await Promise.all([
    // `resources` itself carries a depotPrice now (it's priced on both sides
    // same as any other ware, docs/tags.yaml), so it is excluded here — the
    // hand-built `resourceWare` row above is its one listing, not a second
    // one drawn off the catalog.
    prisma.tag.findMany({ where: { depotPrice: { not: null }, slug: { not: RESOURCE_WARE_ID } }, ...TAG_SELECT }),
    // The reference book: anything with a price in either direction. CATALOG
    // rows only — a minted runtime row (a player's custom painting keeps its
    // base's sellablePrice) must never become a public line in the price
    // book with the player's words on it. Selling one still works: the sell
    // path reads the held row, not this list.
    prisma.tag.findMany({
      where: {
        ephemeral: false,
        slug: { not: RESOURCE_WARE_ID },
        OR: [{ depotPrice: { not: null } }, { sellable: true, sellablePrice: { not: null } }],
      },
      ...TAG_SELECT,
    }),
    prisma.room.findUnique({
      where: { slug: LANDING_PAD_SLUG },
      include: { tags: { include: { tag: TAG_SELECT } } },
    }),
    prisma.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true } }),
    prisma.auditLog.findMany({
      where: { actionType: { in: Object.keys(DEPOT_LEDGER_KINDS) } },
      orderBy: { createdAt: "desc" },
      take: LEDGER_LIMIT,
      select: {
        id: true,
        actionType: true,
        details: true,
        createdAt: true,
        turnId: true,
        targetCharacter: { select: { name: true } },
      },
    }),
  ]);

  // AuditLog carries a turnId but no relation to Turn, so the numbers come
  // back in one extra round trip rather than a join.
  const ledgerTurnIds = [...new Set(ledgerRows.map((r) => r.turnId).filter(Boolean))];
  const ledgerTurnNumbers = new Map(
    ledgerTurnIds.length
      ? (
          await prisma.turn.findMany({
            where: { id: { in: ledgerTurnIds } },
            select: { id: true, number: true },
          })
        ).map((t) => [t.id, t.number])
      : [],
  );

  const heldByTagId = new Map((character?.tags ?? []).map((ct) => [ct.tagId, ct.quantity]));

  const shape = (tag) => ({
    id: tag.id,
    name: tag.name,
    description: tag.description ?? "",
    groupName: tag.group?.name ?? "",
    price: tag.depotPrice,
    sellPrice: tag.sellablePrice,
    // What the station makes on the round trip, from his side of the counter.
    margin: tag.depotPrice != null && tag.sellablePrice != null ? tag.sellablePrice - tag.depotPrice : null,
    held: heldByTagId.get(tag.id) ?? 0,
    stackable: tag.stackable,
    sealed: Boolean(tag.sealedShipping),
    tag,
  });

  // ⬢ are a ware on the shuttle, drawn as a hand-built row rather than off
  // `wareTags` below — the id is the `resources` tag's own slug now (it is a
  // Tag, same as everything else on the shuttle; db/lib/depot.js says so),
  // still not a cuid so it never collides with a real ware's id. `synthetic`
  // is what tells the two tables to print a name instead of a TagChip, since
  // this row carries no Tag to hover.
  const resourceWare = {
    id: RESOURCE_WARE_ID,
    name: "Resources",
    description: "",
    groupName: "",
    price: RESOURCE_IMPORT_PRICE,
    sellPrice: RESOURCE_EXPORT_PRICE,
    margin: RESOURCE_EXPORT_PRICE - RESOURCE_IMPORT_PRICE,
    held: resourcesOf(character),
    stackable: true,
    sealed: false,
    synthetic: true,
    tag: null,
  };

  const wares = [resourceWare, ...wareTags.map(shape)];
  const priceList = [
    { ...resourceWare, side: "Both" },
    ...pricedTags.map((tag) => ({
      ...shape(tag),
      side: tag.depotPrice != null && tag.sellablePrice != null ? "Both" : tag.depotPrice != null ? "Sells to you" : "Buys from you",
    })),
  ];

  const fuelSources = [
    { slug: COAL_SLUG, name: "Coal", perUnit: depot.coalFuel },
    { slug: SALTPETER_SLUG, name: "Saltpeter", perUnit: depot.saltpeterFuel },
  ];
  const bySlug = new Map((character?.tags ?? []).map((ct) => [ct.tag.slug, ct.quantity]));

  const greeting = character
    ? presentedIdentity(character, {
        forcedName: forcedNameFrom(character.tags),
        concealment: concealmentFrom(character.tags),
      }).name
    : null;

  const atDepot = character?.location?.slug === DEPOT_LOCATION_SLUG;
  const powered = depotPowered(depot);
  // Read-only unless you hold the licence. Everything below is a hint anyway —
  // the actions re-check all of it.
  const readOnly = !licensed;
  // A "hand" is anyone who may work the machinery: the licence, or a keycard.
  // Superadmins are deliberately NOT hands — /gm/dev is the GM's door and this
  // page is a thing in a room.
  const hand = licensed || keycard;

  return (
    <SnapshotFresh
      scope="depot"
      userId={session.discordUserId}
      data={{
        depot: {
          accountObols: depot.accountObols,
          debtObols: depot.debtObols,
          creditCapObols: depot.creditCapObols,
          generatorOn: depot.generatorOn,
          generatorFuel: depot.generatorFuel,
          fuelMax: depot.fuelMax,
          fuelBurnPerTurn: depot.fuelBurnPerTurn,
          turretArmed: depot.turretArmed,
          merchantFace: depot.merchantFace,
          shuttleState: depot.shuttleState,
          shuttleTurn: depot.shuttleTurn,
          shuttleMaxTurns: depot.shuttleMaxTurns,
        },
        greetingName: greeting,
        turnNumber: openTurn?.number ?? null,
        fuelTurnsLeft: fuelTurnsLeft(depot),
        readOnly: readOnly,
        hand: hand,
        atDepot: Boolean(atDepot),
        powered: powered,
        // Four flags, because there are two levels of authority and two of
        // them have to survive the lights going out.
        //
        //   disabled            the money and the gun — licence only
        //   handDisabled        the machinery — licence or keycard
        //   handPoweredDisabled the machinery that works in the dark, which
        //                       is the fuel hatch and the starter. Without
        //                       this one a dead generator was unrecoverable
        //                       from the UI: the Feed button was greyed out
        //                       by the very outage it existed to fix.
        //   poweredDisabled     shutting it down — licence only, in the dark
        disabled: readOnly || !atDepot || !powered,
        handDisabled: !hand || !atDepot || !powered,
        handPoweredDisabled: !hand || !atDepot,
        poweredDisabled: readOnly || !atDepot,
        wares: wares,
        priceList: priceList,
        manifest: Array.isArray(depot.manifest) ? depot.manifest : [],
        pad: {
          resources: resourcesOf(pad),
          // ⬢ prints as `pad.resources` above, not as a row here too.
          rows: (pad?.tags ?? [])
            .filter((rt) => rt.tag.slug !== RESOURCE_WARE_ID)
            .map((rt) => ({
              id: rt.id,
              quantity: rt.quantity,
              sellPrice: rt.tag.sellablePrice,
              tag: rt.tag,
            })),
        },
        heldObols: obolTag ? (heldByTagId.get(obolTag.id) ?? 0) : 0,
        resourceExportPrice: RESOURCE_EXPORT_PRICE,
        creditAvailable: creditAvailableObols(depot),
        fuel: {
          turnsLeft: fuelTurnsLeft(depot),
          sources: fuelSources.map((s) => ({ ...s, held: bySlug.get(s.slug) ?? 0 })),
        },
        ledger: ledgerRows.map((r) => {
          const who = r.targetCharacter?.name ?? "—";
          const { detail, delta } = ledgerRow(r, who);
          return {
            id: r.id,
            label: DEPOT_LEDGER_KINDS[r.actionType]?.label ?? r.actionType,
            detail,
            who,
            delta,
            turn: ledgerTurnNumbers.get(r.turnId) ?? null,
            at: r.createdAt.getTime(),
          };
        }),
      }}
    />
  );
}

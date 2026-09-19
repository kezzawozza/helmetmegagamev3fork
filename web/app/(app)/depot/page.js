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
  OBOL_SLUG,
  loadDepot,
  creditAvailableObols,
  RESOURCE_IMPORT_PRICE,
  RESOURCE_EXPORT_PRICE,
  RESOURCE_WARE_ID,
  resourcesOf,
  MANIFESTS,
  MANIFEST_GENERAL,
  manifestOf,
  manifestsFor,
  trainState,
  TREASURY,
  concealmentFrom,
  presentedIdentity,
  forcedNameFrom,
} from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { getOpenTurn } from "@/lib/turn";

// The Depot's counter. See docs/systemdocs/DEPOT.md.
//
// It opens for EVERYONE now, always, and read-only unless you are standing in
// it. That is the whole shape of the rework: the station used to be one man's
// console behind a licence check, and it is a market with a shelf per customer.
//
// What your tags still decide is the SHELF. The general manifest is open to
// anybody; a Silver Chip opens the black market; the Merchant's Licence opens
// everything, sealed goods included (db/lib/depotManifests.js). A Depot Keycard
// is not a shelf at all — it opens the Railyard and cracks a sealed crate.
const TAG_SELECT = { include: { group: { select: { name: true } } } };

// How many ledger rows to hand the client. Enough to be a book, few enough
// that a month-old game does not ship a megabyte of JSON to a browser.
const LEDGER_LIMIT = 200;

// The ledger is built from the audit log: player actions file no Request, and
// every depot action writes `details` in the shape the prose below reads.
const DEPOT_LEDGER_KINDS = {
  request_depot_order: { key: "DEPOT_ORDER", label: "Order" },
  request_depot_drop: { key: "DEPOT_DROP", label: "Sold" },
  request_depot_atm: { key: "DEPOT_ATM", label: "Cash" },
  request_depot_credit: { key: "DEPOT_CREDIT", label: "Credit line" },
  request_depot_account_open: { key: "DEPOT_ACCOUNT", label: "Account" },
  request_depot_crate_open: { key: "DEPOT_CRATE_OPEN", label: "Crate" },
};

// One line of prose per ledger row, and the obols it moved. Derived from the
// `details` snapshot rather than live state — a row has to keep reading
// correctly after the catalog moves under it.
function ledgerRow(entry) {
  const e = entry.details ?? {};
  switch (DEPOT_LEDGER_KINDS[entry.actionType]?.key) {
    case "DEPOT_ORDER":
      return { detail: (e.lines ?? []).map((l) => `${l.name} ×${l.quantity}`).join(", "), delta: -(e.total ?? 0) };
    case "DEPOT_DROP":
      return {
        detail: `${e.tagName ?? "Something"} ×${e.quantity ?? 1} into the dropbox${e.destination && e.destination !== "SELF" ? ` — to the ${e.destination === "TREASURY" ? "Treasury" : "Merchant"}` : ""}`,
        delta: 0,
      };
    case "DEPOT_ATM":
      return {
        detail: e.direction === "WITHDRAW" ? "Withdrawn as coin" : "Deposited",
        delta: e.direction === "WITHDRAW" ? -(e.amount ?? 0) : (e.amount ?? 0),
      };
    case "DEPOT_CREDIT":
      return {
        detail: e.direction === "DRAW" ? "Drawn on the line" : "Repaid the line",
        delta: e.direction === "DRAW" ? (e.amount ?? 0) : -(e.amount ?? 0),
      };
    case "DEPOT_ACCOUNT":
      return { detail: `Account ${e.fingerprint ?? ""} opened`, delta: 0 };
    case "DEPOT_CRATE_OPEN":
      return {
        detail: `${e.crateName ?? "A crate"} — ${(e.granted ?? []).map((g) => `${g.name} ×${g.quantity}`).join(", ") || "empty"}`,
        delta: 0,
      };
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
      bankAccount: true,
      tags: {
        select: {
          quantity: true,
          tagId: true,
          equipped: true,
          // The whole tag, so the drop box can draw each item as a TagChip.
          tag: TAG_SELECT,
        },
      },
    },
  });

  const heldSlugs = new Set((character?.tags ?? []).map((ct) => ct.tag.slug));
  const licensed = heldSlugs.has(MERCHANT_LICENSE_SLUG);
  const keycard = heldSlugs.has(DEPOT_KEYCARD_SLUG);
  const superadmin = isSuperadmin(session.discordUserId);

  // Nobody is bounced any more. A spectator with no living character reads the
  // price list and the manifests like anybody else; the page is a shop window.
  const depot = await loadDepot(prisma);
  const openTurn = await getOpenTurn();
  const account = character?.bankAccount ?? null;

  const [wareTags, pricedTags, obolTag, ledgerRows, mySales, allStagedSales] = await Promise.all([
    // `resources` itself carries a depotPrice (docs/tags.yaml), so it is
    // excluded here — the hand-built `resourceWare` row below is its one
    // listing, not a second one drawn off the catalog.
    prisma.tag.findMany({ where: { depotPrice: { not: null }, slug: { not: RESOURCE_WARE_ID } }, ...TAG_SELECT }),
    // The reference book: anything with a price in either direction. CATALOG
    // rows only — a minted runtime row (a player's custom painting keeps its
    // base's sellablePrice) must never become a public line in the price book
    // with the player's words on it. Selling one still works: the drop box
    // reads the held row, not this list.
    prisma.tag.findMany({
      where: {
        ephemeral: false,
        slug: { not: RESOURCE_WARE_ID },
        OR: [{ depotPrice: { not: null } }, { sellable: true, sellablePrice: { not: null } }],
      },
      ...TAG_SELECT,
    }),
    prisma.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true } }),
    prisma.auditLog.findMany({
      where: {
        actionType: { in: Object.keys(DEPOT_LEDGER_KINDS) },
        ...(character ? { targetCharacterId: character.id } : { id: "" }),
      },
      orderBy: { createdAt: "desc" },
      take: LEDGER_LIMIT,
      select: { id: true, actionType: true, details: true, createdAt: true, turnId: true },
    }),
    account
      ? prisma.depotSale.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, take: 200 })
      : [],
    // The Licence sees every account's staged selling — that is what running
    // the station buys. Settled rows stay each seller's own business.
    licensed ? prisma.depotSale.findMany({ where: { settledAt: null }, orderBy: { createdAt: "desc" }, take: 200 }) : [],
  ]);

  // AuditLog carries a turnId but no relation to Turn, so the numbers come
  // back in one extra round trip rather than a join.
  const ledgerTurnIds = [...new Set(ledgerRows.map((r) => r.turnId).filter(Boolean))];
  const ledgerTurnNumbers = new Map(
    ledgerTurnIds.length
      ? (await prisma.turn.findMany({ where: { id: { in: ledgerTurnIds } }, select: { id: true, number: true } })).map(
          (t) => [t.id, t.number],
        )
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
    held: heldByTagId.get(tag.id) ?? 0,
    stackable: tag.stackable,
    sealed: Boolean(tag.sealedShipping),
    manifest: manifestOf(tag),
    tag,
  });

  // ⬢ are a ware like any other, drawn as a hand-built row rather than off
  // `wareTags` — the id is the `resources` tag's own slug, still not a cuid, so
  // it never collides with a real ware's id. `synthetic` is what tells the
  // tables to print a name instead of a TagChip, since this row carries no Tag
  // to hover.
  const resourceWare = {
    id: RESOURCE_WARE_ID,
    name: "Resources",
    description: "",
    groupName: "",
    price: RESOURCE_IMPORT_PRICE,
    sellPrice: RESOURCE_EXPORT_PRICE,
    held: resourcesOf(character),
    stackable: true,
    sealed: false,
    manifest: MANIFEST_GENERAL,
    synthetic: true,
    tag: null,
  };

  const wares = [resourceWare, ...wareTags.map(shape)];
  const priceList = [
    { ...resourceWare, side: "Both" },
    ...pricedTags.map((tag) => ({
      ...shape(tag),
      side:
        tag.depotPrice != null && tag.sellablePrice != null
          ? "Both"
          : tag.depotPrice != null
            ? "Sells to you"
            : "Buys from you",
    })),
  ];

  // What this character may actually be offered, and what every manifest is,
  // so the Manifests tab can show the doors that are shut as well as the open ones.
  const openManifests = manifestsFor(heldSlugs).map((m) => m.id);

  // Anything sellable in your own hands, for the drop box's picker. A crate
  // included: an unopened crate is worth what it says on the side.
  const sellable = (character?.tags ?? [])
    .filter((ct) => ct.tag.sellablePrice != null && ct.quantity > 0)
    .map((ct) => ({ tagId: ct.tagId, name: ct.tag.name, quantity: ct.quantity, unitPrice: ct.tag.sellablePrice, tag: ct.tag }));

  const greeting = character
    ? presentedIdentity(character, {
        forcedName: forcedNameFrom(character.tags),
        concealment: concealmentFrom(character.tags),
      }).name
    : null;

  const atDepot = character?.location?.slug === DEPOT_LOCATION_SLUG;
  // Everything below is a hint. The actions re-check all of it
  // (requireDepotStanding in ./actions.js).
  const disabled = !character || !atDepot;

  const saleShape = (row) => ({
    id: row.id,
    fingerprint: row.fingerprint,
    holderName: row.holderName,
    destination: row.destination,
    tagName: row.tagName,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    droppedTurn: row.droppedTurn,
    settled: Boolean(row.settledAt),
    settledTurn: row.settledTurn,
    grossObols: row.grossObols,
    taxObols: row.taxObols,
    netObols: row.netObols,
  });

  return (
    <SnapshotFresh
      scope="depot"
      userId={session.discordUserId}
      data={{
        depot: {
          debtObols: depot.debtObols,
          creditCapObols: depot.creditCapObols,
          turretArmed: depot.turretArmed,
        },
        greetingName: greeting,
        turnNumber: openTurn?.number ?? null,
        train: trainState(openTurn?.number ?? 0),
        account: account
          ? {
              fingerprint: account.fingerprint,
              holderName: account.holderName,
              class: account.class,
              balanceObols: account.balanceObols,
              backed: account.class === TREASURY,
            }
          : null,
        licensed,
        keycard,
        superadmin,
        atDepot: Boolean(atDepot),
        disabled,
        // The Merchant and his Dockers sell into his books by default; everyone
        // else sells into their own. A per-drop choice, not a stored setting —
        // the dropdown at the top of the Selling tab only seeds the next drop.
        defaultDestination: licensed || keycard ? "MERCHANT" : "SELF",
        canSellToMerchant: licensed || keycard,
        wares,
        priceList,
        manifests: MANIFESTS,
        openManifests,
        sellable,
        sales: mySales.map(saleShape),
        allStagedSales: allStagedSales.map(saleShape),
        heldObols: obolTag ? (heldByTagId.get(obolTag.id) ?? 0) : 0,
        creditAvailable: creditAvailableObols(depot),
        ledger: ledgerRows.map((r) => {
          const { detail, delta } = ledgerRow(r);
          return {
            id: r.id,
            label: DEPOT_LEDGER_KINDS[r.actionType]?.label ?? r.actionType,
            detail,
            delta,
            turn: ledgerTurnNumbers.get(r.turnId) ?? null,
            at: r.createdAt.getTime(),
          };
        }),
      }}
    />
  );
}

import { prisma, MORTUS_SLUG } from "@lifeweb/db";
import { canReadTreasury } from "@lifeweb/db/lib/depotCounter";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { railKindSql } from "@/lib/dmThread";

export const PLAYER_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/chat", label: "Chat", icon: "play" },
  { href: "/map", label: "Map", icon: "map" },
  { href: "/faction", label: "Faction", icon: "faction" },
  { href: "/notes", label: "Notes", icon: "notes" },
  { href: "/documents", label: "Documents", icon: "documents" },
  { href: "/handbook", label: "Handbook", icon: "help" },
];

// `section` splits the rail into a GM's two hats; NavRail dividers follow the order below.
export const GM_NAV = [
  { href: "/gm/players", label: "Players", icon: "messages", section: "gm" },
  { href: "/gm/turns", label: "Adjudicate", icon: "turns", section: "gm" },
  { href: "/gm/audit", label: "Audit", icon: "audit", section: "gm" },
  { href: "/gm/economy", label: "Economy", icon: "economy", section: "gm" },
  { href: "/gm/oracle", label: "Oracle", icon: "oracle", section: "gm" },
  { href: "/character", label: "Character", icon: "character", section: "player" },
  { href: "/chat", label: "Chat", icon: "play", section: "player" },
  { href: "/map", label: "Map", icon: "map", section: "player" },
  { href: "/notes", label: "Notes", icon: "notes", section: "player" },
  { href: "/documents", label: "Documents", icon: "documents", section: "player" },
  { href: "/handbook", label: "Handbook", icon: "help", section: "player" },
];

const DEV_NAV_ITEM = { href: "/gm/dev", label: "Dev", icon: "dev", section: "gm" };
const LIFEWEB_NAV_ITEM = { href: "/lifeweb", label: "Lifeweb", icon: "lifeweb", section: "player" };
const ARCHIVE_NAV_ITEM = { href: "/archive", label: "Archive", icon: "archive", section: "gm" };
// On every player's rail, always. The Depot is a public market now and the page
// is a shop window — read-only unless you are standing in it, which is the page's
// own business, not the rail's. See docs/systemdocs/DEPOT.md §2.
const DEPOT_NAV_ITEM = { href: "/depot", label: "Depot", icon: "store", section: "player" };
// The Meister's terminal over the town's accounts. Follows PLACE AND KEY, the
// same predicate the page itself gates on (db/lib/depotCounter.js), so the rail
// can never offer an item that redirects. It comes and goes as its holder walks
// in and out of the Keep, which is the cost of a terminal being a thing on a
// desk. See docs/systemdocs/DEPOT.md §0h.
const TREASURY_NAV_ITEM = { href: "/treasury", label: "Treasury", icon: "store", section: "player" };

// Streamed separately (Suspense boundary in AppRail) — the live Discord role check and the
// Mortus-tag lookup never block a navigation's paint.
async function loadUnreadConversationCount(discordUserId) {
  // railKindSql is not optional: without it the badge counts rows the desk it points at does not.
  const rows = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT dm."discordUserId")::int AS "count"
    FROM "DirectMessage" dm
    LEFT JOIN "ConversationRead" cr
      ON cr."playerDiscordUserId" = dm."discordUserId"
      AND cr."gmDiscordUserId" = ${discordUserId}
    WHERE dm."direction" = 'INBOUND'
      AND dm."createdAt" > COALESCE(cr."lastReadAt", to_timestamp(0))
      AND ${railKindSql("dm")}
  `;
  return rows[0]?.count ?? 0;
}

export async function loadNavItems(discordUserId) {
  const [{ isGm: gm }, hasMortusTag, treasuryGate, gameConfig] = await Promise.all([
    getGmSession(),
    prisma.characterTag.findFirst({
      where: { character: { discordUserId, status: "ALIVE" }, tag: { slug: MORTUS_SLUG } },
    }),
    canReadTreasury(prisma, discordUserId),
    // Chat switch (CHAT.md §5). Presentation here; /chat enforces it.
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { playPanelEnabled: true, oraclePlaytest: true } }),
  ]);
  const superadmin = isSuperadmin(discordUserId);
  // The Lifeweb item follows the Mortus tag, not the GM role — a superadmin keeps it, host access
  // rather than game permission, the way /gm/dev works.
  const hasMortus = !!hasMortusTag || superadmin;

  const unreadCount = gm ? await loadUnreadConversationCount(discordUserId) : 0;
  const playEnabled = gameConfig?.playPanelEnabled ?? true;
  const oracleHidden = (gameConfig?.oraclePlaytest ?? false) && !superadmin;
  const baseNav = (gm ? GM_NAV : PLAYER_NAV)
    .filter((item) => playEnabled || item.href !== "/chat")
    .filter((item) => !oracleHidden || item.href !== "/gm/oracle")
    .map((item) =>
      item.href === "/gm/players" && unreadCount > 0 ? { ...item, badge: unreadCount } : item,
    );
  const withLifeweb = hasMortus ? [...baseNav, LIFEWEB_NAV_ITEM] : baseNav;
  const withArchive = gm ? [...withLifeweb, ARCHIVE_NAV_ITEM] : withLifeweb;
  const withDepot = [...withArchive, DEPOT_NAV_ITEM];
  const withTreasury = treasuryGate.ok || superadmin ? [...withDepot, TREASURY_NAV_ITEM] : withDepot;
  if (!superadmin) return withTreasury;
  const lastGm = withTreasury.findLastIndex((item) => item.section === "gm");
  return [...withTreasury.slice(0, lastGm + 1), DEV_NAV_ITEM, ...withTreasury.slice(lastGm + 1)];
}

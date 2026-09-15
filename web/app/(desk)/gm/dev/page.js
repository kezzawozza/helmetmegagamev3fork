import SubmitButton from "@/app/components/SubmitButton";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma, loadDepot } from "@lifeweb/db";
import { isSuperadmin } from "@/lib/superadmin";
import { getDevTier, resolveSection } from "@/lib/devAccess";
import { getOpenTurn } from "@/lib/turn";
import { describeTurn } from "@/lib/turnFormat";
import { listGuildMembers, listGmMembers, getGmSession } from "@/lib/discordGuild";
import { visibleZoneIds } from "@lifeweb/db/lib/gmZoneView";
import { inactiveCharacters, inactiveRows } from "@lifeweb/db/lib/inactivity";
import { TRIAL_GM_ROLE_ID } from "@lifeweb/db/lib/roleIds";
import CharacterLink from "@/app/components/CharacterLink";
import {
  OPT_IN_THREATS,
  ASSIGNABLE_THREATS,
  SEAT_TAG_SLUGS,
  antagonistNames,
  threatBySeatTag,
  threatBySlug,
  optInName,
  optInWhitelisted,
  PARTIES,
} from "@/lib/threats";
import { PLAYER_ROLE_ID, LEADER_WHITELIST_ROLE_ID } from "@lifeweb/db/lib/roleIds";
import { roleCapacity, seatHolderStatuses } from "@lifeweb/db/lib/roleCapacity";
import {
  updateGameConfig,
  updateDepot,
  updateCurrentTurn,
  updateNextTurn,
  updateWorldState,
  runDoctorAction,
  defuseNukeAction,
  cancelAscensionAction,
} from "@/app/(app)/gm/dev/actions";
import OracleForm from "@/app/(app)/gm/dev/OracleForm";
import { loadOracleSettings } from "@/app/(app)/gm/dev/oracleActions";
import EndTurnButton from "@/app/(app)/gm/dev/EndTurnButton";
import WipeGameButton from "@/app/(app)/gm/dev/WipeGameButton";
import ArchiveGameButton from "@/app/(app)/gm/dev/ArchiveGameButton";
import QuestsSection from "@/app/(app)/gm/dev/quests/QuestsSection";
import { turnsRemaining } from "@lifeweb/db/lib/quests";
import { hasNoticeboard } from "@lifeweb/db/lib/noticeboard";
import ThreatAssignmentsTable from "@/app/(app)/gm/dev/threats/ThreatAssignmentsTable";
import ThreatRosterTable from "@/app/(app)/gm/dev/threats/ThreatRosterTable";
import ObjectivesPanel from "@/app/(app)/gm/dev/threats/ObjectivesPanel";
import RitesPanel from "@/app/(app)/gm/dev/threats/RitesPanel";
import BulkActions from "./BulkActions";
import AmbientForm from "./AmbientForm";
import InactivePanel from "./InactivePanel";
import MirrorPreview from "./MirrorPreview";
import { RITES, riteByKey } from "@lifeweb/db/lib/rites";
import { ensureRiteWords } from "@lifeweb/db/lib/riteWords";
import { listObjectives, locationEligible, membersByParty } from "@lifeweb/db/lib/objectives";
import { kindsForParty, OBJECTIVE_WEIGHTS, PARTY_DEFAULTS, INQUISITOR_OR_BARON_ROLE_SLUGS } from "@lifeweb/db/lib/objectiveKinds";
import { effectivePlayerCount, GAME_STATE_CREATE } from "@lifeweb/db/lib/gameState";
import GameControls from "./GameControls";
import PastGames from "./PastGames";
import ConfigForm from "./ConfigForm";
import LobbyRoster from "./LobbyRoster";
import SeatsOut from "./SeatsOut";
import GmRosterTable from "./GmRosterTable";
import AssignmentPreview from "./AssignmentPreview";
import { isSpawnOnly } from "@/lib/characterCreation";
import DeskHeader, { DeskTurnChip } from "@/app/components/DeskHeader";
import LockChip from "@/app/components/LockChip";
import OpsNav from "./OpsNav";
import SendLetterForm from "./SendLetterForm";
import Switch from "@/app/components/Switch";
import Select from "@/app/components/Select";
import StatusPill from "@/app/components/StatusPill";
import EmptyState from "@/app/components/EmptyState";
import { shortId } from "@/lib/gameLabel";

// Eight numeric Depot knobs share one shape, so they share one component
// rather than eight copies of the same six lines.
function DepotField({ name, label, value }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type="number" id={`depot-${name}`} name={name} min="0" defaultValue={value} />
    </label>
  );
}

// The catalog as the two tables need it. Flattened here rather than passed
// whole: a client component gets plain data.
// The union of both, not just the opt-ins: a seat can be assignable without
// ever having been a checkbox (the Tribunal will be), and the table needs it
// in the Assign dropdown regardless.
const THREAT_SUMMARY = [...new Set([...OPT_IN_THREATS, ...ASSIGNABLE_THREATS])].map((t) => ({
  slug: t.slug,
  name: t.name,
  optIn: Boolean(t.optIn),
  // What the checkbox said, which is what the opt-in chips and filter show.
  optInName: optInName(t),
  optInWhitelisted: optInWhitelisted(t),
  assignable: Boolean(t.assignable),
  tagPoints: t.assign?.tagPoints ?? 0,
  spawnRoleSlug: t.spawn?.roleSlug ?? null,
}));
const ASSIGNABLE_SUMMARY = ASSIGNABLE_THREATS.map((t) => ({ slug: t.slug, name: t.name }));

const PHASE_LABEL = { CLOSED: "Closed", LOBBY: "Lobby", RUNNING: "Running", ENDED: "Ended" };
const PHASE_TONE = { CLOSED: "neutral", LOBBY: "warn", RUNNING: "good", ENDED: "bad" };

// The four numbers a GM opens this section to find, off props the page already
// built. No query of its own — every one of these is a length.
function antagonistGlance(seats, parties, rites) {
  const objectives = parties.flatMap((p) => p.objectives);
  const done = objectives.filter((o) => o.done).length;
  const live = rites.filter((r) => r.status === "OPEN" || r.status === "READY" || r.status === "AWAITING").length;
  return [
    `${seats.length} seat${seats.length === 1 ? "" : "s"} held`,
    `${parties.length} part${parties.length === 1 ? "y" : "ies"}`,
    `${done} of ${objectives.length} objectives`,
    `${live} rite${live === 1 ? "" : "s"} in flight`,
  ];
}

function stamp(date) {
  return new Date(date).toISOString().slice(0, 16).replace("T", " ");
}

// A report's per-step breakdown is the useful half but far too long to dump
// inline, so the JSON line drops it and the five slowest steps get their own
// rows. That is how the message wipe says which zone ate the hour.
function summaryHead(summary) {
  const { steps, ...rest } = summary ?? {};
  return rest;
}

function slowestSteps(summary) {
  const steps = summary?.steps;
  if (!Array.isArray(steps) || steps.length === 0 || typeof steps[0] !== "object") return [];
  return [...steps].sort((a, b) => (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0)).slice(0, 5);
}

function reportTone(report) {
  if (!report.finishedAt) return "warn";
  return report.ok ? "good" : "bad";
}

function reportLabel(report) {
  if (!report.finishedAt) return "unfinished";
  return report.ok ? "clean" : "issues";
}

// Which seat somebody holds. The two GM roles are access-identical
// (db/lib/roleIds.js), so this chip is the only place in the app that tells
// them apart — which is the whole reason the trial role exists.
// Keyed on the trial role alone rather than on DISCORD_GM_ROLE_ID: nothing
// reads that env var directly any more (db/lib/roleIds.js), and this is a
// label, not a gate. Somebody holding both roles reads as Trial GM, which is
// a state nobody should be in — the trial role is what you hold *instead*.
// A standing is a state, so it is a StatusPill with a tone rather than a chip:
// full and trial GMs are access-identical (CLAUDE.md), and the whole point of
// this column is that it is the ONE surface telling them apart. Two identical
// grey chips did not.
function gmStanding(member) {
  return member.roles.includes(TRIAL_GM_ROLE_ID)
    ? { label: "Trial GM", tone: "warn" }
    : { label: "Gamemaster", tone: "good" };
}

export default async function DevPanelPage({ searchParams }) {
  const tier = await getDevTier();
  if (tier === "none") redirect("/character");
  const { session } = await getGmSession();

  const { s } = await searchParams;
  // Not a redirect on a section this tier cannot open: a GM following an old
  // ?s=danger link should land on their own home section, not be bounced off
  // the panel entirely.
  const section = resolveSection(tier, s);
  const isMaster = tier === "super";

  // Always fetched: the header needs the open turn regardless of section,
  // and the turn section derives day and phase from the same rows.
  const [config, state, openTurnRecord, lastTurn, depot, readyCount] = await Promise.all([
    prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    prisma.gameState.upsert({ where: { id: 1 }, update: {}, create: GAME_STATE_CREATE, include: {
      game: {
        select: {
          id: true, nukeDetonatedTurn: true, ascensionFiredTurn: true,
          exportKey: true, entryCount: true,
        },
      },
    } }),
    getOpenTurn(),
    prisma.turn.findFirst({ orderBy: { number: "desc" } }),
    loadDepot(prisma),
    prisma.lobbyEntry.count({ where: { status: "READY" } }),
  ]);

  // The GM roster, only when its own section is open — it costs a full guild
  // member fetch, and every other section would pay for it otherwise.
  const gmRoster =
    section === "gamemasters"
      ? [...(await listGmMembers())].sort((a, b) =>
          (a.globalName ?? a.username).localeCompare(b.globalName ?? b.username),
        )
      : [];
  // GMs may play too, and may not — which is exactly why the roster is keyed
  // on discordUserId rather than hung off Character.
  const gmCharacters = gmRoster.length
    ? await prisma.character.findMany({
        where: { discordUserId: { in: gmRoster.map((m) => m.id) }, status: "ALIVE" },
        select: { id: true, name: true, discordUserId: true },
      })
    : [];
  const gmCharacterByUserId = new Map(gmCharacters.map((c) => [c.discordUserId, c]));

  const currentDay = openTurnRecord ? Math.ceil(openTurnRecord.number / 2) : Math.ceil(((lastTurn?.number ?? 0) + 1) / 2);
  const currentPhase = openTurnRecord?.phase ?? (lastTurn?.phase === "DAWN" ? "DUSK" : "DAWN");

  let locations = [];
  let livingCharacters = [];
  let bulkCharacters = [];
  let bulkTags = [];
  let questRows = [];
  let questLocations = [];
  let questTags = [];
  let questCharacters = [];
  let questBoards = [];
  let questZones = [];
  let ambientZones = [];
  let ambientLocations = [];
  let ambientRooms = [];
  let inactiveList = [];
  let inactiveTurn = null;
  let latestByKind = new Map();
  // The two threat sections. Each fetches only its own data, same as every
  // other section here.
  let assignmentRows = [];
  let spawnRoles = [];
  let spawnLocations = [];
  let seatRows = [];
  let pendingSpawns = [];
  let riteWordRows = [];
  let riteAttemptRows = [];
  // The Objectives cards under the roster (THREATS.md §6a).
  let objectiveParties = [];
  let objectiveCharacters = [];
  let objectiveLocations = [];
  let lobbyRows = [];
  // Seats handed out that nobody has taken up yet (LOBBY.md). Its own list
  // rather than a slice of lobbyRows, because that one is built only for the
  // superadmin Game section and this has to reach an ordinary GM.
  let seatsOut = [];
  let draftRows = [];
  let pickableRoles = [];
  // The Games section: every game there has ever been, and how much of each
  // one's transcript is still in the database.
  let pastGames = [];
  let archiveCounts = {};

  switch (section) {
    case "game": {
      // Everyone with a lobby row, joined to their preferences and their
      // Discord handle. The roll reads the same three tables
      // (db/lib/roleAssignment.js), so what a GM sees here is what it sees.
      const [entries, prefs, members, roles] = await Promise.all([
        prisma.lobbyEntry.findMany({
          orderBy: { readyAt: "asc" },
          include: { assignedRole: { select: { name: true } } },
        }),
        prisma.playerPreference.findMany(),
        listGuildMembers(),
        prisma.role.findMany({ select: { slug: true, name: true } }),
      ]);
      const prefByUser = new Map(prefs.map((p) => [p.discordUserId, p]));
      const memberByUser = new Map(members.map((m) => [m.id, m]));
      const roleName = new Map(roles.map((r) => [r.slug, r.name]));
      pickableRoles = roles.filter((r) => !isSpawnOnly(r)).sort((a, b) => a.name.localeCompare(b.name));
      draftRows = (state.assignmentDraft?.rows ?? []).map((row) => {
        const m = memberByUser.get(row.discordUserId);
        return {
          discordUserId: row.discordUserId,
          handle: m ? m.globalName || m.username : row.discordUserId,
          roleSlug: row.roleSlug,
          roleName: row.roleSlug ? (roleName.get(row.roleSlug) ?? row.roleSlug) : null,
          source: row.source,
        };
      });
      lobbyRows = entries.map((e) => {
        const p = prefByUser.get(e.discordUserId);
        const m = memberByUser.get(e.discordUserId);
        const pr = p?.rolePriorities ?? {};
        const levels = Object.entries(pr);
        const highSlug = levels.find(([, l]) => l === "HIGH")?.[0] ?? null;
        return {
          discordUserId: e.discordUserId,
          handle: m ? m.globalName || m.username : e.discordUserId,
          readyAt: e.readyAt.toISOString().slice(5, 16).replace("T", " "),
          high: highSlug ? (roleName.get(highSlug) ?? highSlug) : null,
          medium: levels.filter(([, l]) => l === "MEDIUM").length,
          low: levels.filter(([, l]) => l === "LOW").length,
          optIns: antagonistNames(p?.antagonistOptIns ?? []),
          whitelisted: Boolean(m?.roles.includes(LEADER_WHITELIST_ROLE_ID)),
          jobless: { COMMONER: "Commoner", MIGRANT: "Migrant", RETURN_TO_LOBBY: "Lobby" }[p?.joblessRole ?? "COMMONER"],
          status: e.status,
          assigned: e.assignedRole?.name ?? null,
          expiresAt: e.expiresAt ? e.expiresAt.toISOString().slice(5, 16).replace("T", " ") : null,
        };
      });
      break;
    }
    case "games": {
      const [rows, counts] = await Promise.all([
        prisma.game.findMany({
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            label: true,
            startedAt: true,
            endedAt: true,
            createdAt: true,
            playerCount: true,
            closingNote: true,
            epilogue: true,
            nukeDetonatedTurn: true,
            ascensionFiredTurn: true,
            exportKey: true,
            entryCount: true,
            archivedAt: true,
          },
        }),
        // Counted live rather than read off epilogue.facts.archived: that one
        // is a snapshot from the moment a game ended, and the game being
        // played has no epilogue at all. One grouped scan of the gameId index.
        prisma.archiveEntry.groupBy({ by: ["gameId"], _count: { _all: true } }),
      ]);
      pastGames = rows;
      archiveCounts = Object.fromEntries(counts.map((c) => [c.gameId, c._count._all]));
      break;
    }
    case "bulk": {
      const [allLocations, living, allTags] = await Promise.all([
        prisma.location.findMany({
          orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
          select: { id: true, name: true, zoneId: true, zone: { select: { name: true } } },
        }),
        prisma.character.findMany({
          where: { status: "ALIVE" },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            location: { select: { name: true } },
            zone: { select: { name: true } },
          },
        }),
        prisma.tag.findMany({ orderBy: { name: "asc" }, select: { slug: true, name: true } }),
      ]);
      locations = allLocations;
      // Flattened here rather than in the client: the picker searches and
      // filters on the place, so it wants one string, not a nested row.
      bulkCharacters = living.map((c) => ({
        id: c.id,
        name: c.name,
        zoneName: c.zone?.name ?? "",
        placeLabel: c.location
          ? `${c.zone?.name ?? ""} — ${c.location.name}`.replace(/^ — /, "")
          : "nowhere",
      }));
      bulkTags = allTags;
      break;
    }
    case "quests": {
      // Scoped to the zones this GM watches, the same filter the desks and
      // Say-something apply. questActions.js re-checks it — a <select> is a
      // hint, not a lock.
      const allowed = await visibleZoneIds(prisma, session.discordUserId);
      const inView = (zoneId) => !allowed || (zoneId && allowed.has(zoneId));

      const [questList, locationRows, tagRows, characterRows, zoneRows] = await Promise.all([
        prisma.quest.findMany({
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
          include: {
            location: { select: { id: true, name: true, zoneId: true, zone: { select: { name: true, kind: true } } } },
            interactions: {
              orderBy: { createdAt: "desc" },
              select: { id: true, intention: true, turnId: true, character: { select: { name: true } } },
            },
          },
        }),
        prisma.location.findMany({
          where: { discordChannelId: { not: null } },
          orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
          select: { id: true, name: true, zoneId: true, attributes: true, zone: { select: { name: true } } },
        }),
        // Only tags a GM could sensibly gate on: the catalog, not the runtime
        // paper and custom crafts, which would bury the list.
        prisma.tag.findMany({
          where: { ephemeral: false },
          orderBy: { name: "asc" },
          select: { slug: true, name: true },
        }),
        prisma.character.findMany({
          where: { status: "ALIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.zone.findMany({
          where: { discordSummaryChannelId: { not: null } },
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true },
        }),
      ]);

      // One lookup for every turn a press was filed in, so the interactions
      // table can print a turn NUMBER rather than a cuid.
      const turnIds = [...new Set(questList.flatMap((q) => q.interactions.map((i) => i.turnId)))];
      const turns = turnIds.length
        ? await prisma.turn.findMany({ where: { id: { in: turnIds } }, select: { id: true, number: true } })
        : [];
      const turnNumberById = new Map(turns.map((t) => [t.id, t.number]));

      questRows = questList
        .filter((q) => inView(q.location?.zoneId))
        .map((q) => ({
          id: q.id,
          title: q.title,
          description: q.description,
          status: q.status,
          locationId: q.locationId,
          locationName: q.location?.name ?? "?",
          zoneId: q.location?.zoneId ?? null,
          zoneName: q.location?.zone?.name ?? "Unzoned",
          cave: q.location?.zone?.kind === "CAVE_LEVEL",
          turnsLeft: turnsRemaining(q, openTurnRecord?.number ?? null),
          accessTagSlugs: q.accessTagSlugs,
          allowedCharacterIds: q.allowedCharacterIds,
          interactionCount: q.interactions.length,
          interactions: q.interactions.map((i) => ({
            id: i.id,
            intention: i.intention,
            characterName: i.character?.name ?? "—",
            turnNumber: turnNumberById.get(i.turnId) ?? null,
          })),
        }));

      questLocations = locationRows
        .filter((l) => inView(l.zoneId))
        .map((l) => ({ id: l.id, label: `${l.zone?.name ?? "Unzoned"} — ${l.name}` }));
      questTags = tagRows;
      questCharacters = characterRows;
      questZones = zoneRows.filter((z) => inView(z.id)).map((z) => ({ id: z.id, label: z.name }));

      // The boards, from the same locationAttributes registry the Discord
      // panel reads — never a second list of which places have one.
      const boardLocations = locationRows.filter((l) => inView(l.zoneId) && hasNoticeboard(l));
      const posts = boardLocations.length
        ? await prisma.noticePost.findMany({
            where: { locationId: { in: boardLocations.map((l) => l.id) } },
            orderBy: { postedTurn: "asc" },
            select: { id: true, locationId: true, tag: { select: { name: true } } },
          })
        : [];
      questBoards = boardLocations.map((l) => ({
        locationId: l.id,
        locationName: `${l.zone?.name ?? "Unzoned"} — ${l.name}`,
        notices: posts.filter((p) => p.locationId === l.id).map((p) => ({ id: p.id, name: p.tag.name })),
      }));
      break;
    }
    case "ambient": {
      // Scoped to the zones this GM watches (db/lib/gmZoneView.js — no rows
      // means every zone), the same filter the desks apply. The action
      // re-checks it: a <select> is a hint, not a lock.
      const allowed = await visibleZoneIds(prisma, session.discordUserId);
      const [zoneRows, locationRows, roomRows] = await Promise.all([
        prisma.zone.findMany({
          where: { discordSummaryChannelId: { not: null } },
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true },
        }),
        prisma.location.findMany({
          where: { discordChannelId: { not: null } },
          orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
          select: { id: true, name: true, zoneId: true, zone: { select: { name: true } } },
        }),
        prisma.room.findMany({
          where: { discordThreadId: { not: null } },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            location: { select: { name: true, zoneId: true, zone: { select: { name: true } } } },
          },
        }),
      ]);
      const inView = (zoneId) => !allowed || (zoneId && allowed.has(zoneId));
      ambientZones = zoneRows.filter((z) => inView(z.id)).map((z) => ({ id: z.id, label: z.name }));
      ambientLocations = locationRows
        .filter((l) => inView(l.zoneId))
        .map((l) => ({ id: l.id, label: `${l.zone?.name ?? "Unzoned"} — ${l.name}` }));
      ambientRooms = roomRows
        .filter((r) => inView(r.location?.zoneId))
        .map((r) => ({ id: r.id, label: `${r.location?.name ?? "?"} — ${r.name}` }));
      break;
    }
    case "letters":
      // Living only: the letter mints paper onto a sheet, and a corpse's is
      // not read. (The player Bird lists the dead too, because there the list
      // itself would be a casualty report — here the GM already knows.)
      livingCharacters = await prisma.character.findMany({
        where: { status: "ALIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, location: { select: { name: true } } },
      });
      break;
    case "reports": {
      // Latest report per kind — the section renders what actually happened,
      // instead of the fake success the wipe used to claim.
      const [reports, inactive] = await Promise.all([
        prisma.systemReport.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
        inactiveCharacters(prisma),
      ]);
      for (const report of reports) {
        if (!latestByKind.has(report.kind)) latestByKind.set(report.kind, report);
      }
      inactiveTurn = inactive.turn;
      inactiveList = inactiveRows(inactive);
      break;
    }
    case "assignments": {
      // Rows are every APPROVED PLAYER in the guild, not every character:
      // a SPAWN is aimed precisely at the people who are not in the game, so
      // a player with no character is a real row rather than a gap.
      const [members, characters, roles, locationRows, preferences, openSeats] = await Promise.all([
        listGuildMembers(),
        // ALIVE only: Catatonic is a TAG on a living character, not a status,
        // and a dead one is not somebody you hand a seat to.
        prisma.character.findMany({
          where: { status: "ALIVE" },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            discordUserId: true,
            status: true,
            roleTitle: true,
            antagonistOptIns: true,
            zone: { select: { name: true } },
            tags: { select: { tag: { select: { slug: true } } } },
          },
        }),
        prisma.role.findMany({
          orderBy: [{ name: "asc" }],
          select: {
            id: true,
            slug: true,
            name: true,
            isUnique: true,
            unlimited: true,
            weight: true,
            startingLocationId: true,
          },
        }),
        prisma.location.findMany({
          orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
          select: { id: true, name: true, zone: { select: { name: true } } },
        }),
        // Lobby consent for the players who have no character yet: before
        // Start, the preference row is the only place a tick lives.
        prisma.playerPreference.findMany({ select: { discordUserId: true, antagonistOptIns: true } }),
        // Seats that have been handed out and not taken up. ASSIGNED is the
        // status between the DM going out and the character existing — CREATED
        // means they built it, DECLINED and EXPIRED mean the seat is free
        // again, and READY means they are still in the queue.
        prisma.lobbyEntry.findMany({
          where: { status: "ASSIGNED", characterId: null, assignedRoleId: { not: null } },
          orderBy: { expiresAt: "asc" },
          select: {
            discordUserId: true,
            assignedAt: true,
            expiresAt: true,
            reminderSentAt: true,
            assignedRole: { select: { name: true } },
          },
        }),
      ]);

      const byUser = new Map(characters.map((c) => [c.discordUserId, c]));
      const prefByUser = new Map(preferences.map((p) => [p.discordUserId, p.antagonistOptIns]));
      assignmentRows = members
        .filter((m) => m.roles.includes(PLAYER_ROLE_ID))
        .map((m) => {
          const c = byUser.get(m.id) ?? null;
          // The seat is DERIVED from the held tag, so a GM who granted it by
          // hand from the character panel still shows up as holding it.
          const heldSlugs = new Set((c?.tags ?? []).map((t) => t.tag.slug));
          const seat = SEAT_TAG_SLUGS.map(threatBySeatTag).find((t) => t && heldSlugs.has(t.seatTagSlug));
          return {
            discordUserId: m.id,
            handle: m.globalName || m.username,
            characterId: c?.id ?? null,
            characterName: c?.name ?? null,
            roleTitle: c?.roleTitle ?? null,
            zoneName: c?.zone?.name ?? null,
            statusLabel: c ? c.status : "Not in game",
            // The character's locked snapshot once it exists, the live lobby
            // preference until then.
            optInNames: antagonistNames(c ? c.antagonistOptIns : (prefByUser.get(m.id) ?? [])),
            whitelisted: m.roles.includes(LEADER_WHITELIST_ROLE_ID),
            seatName: seat?.name ?? null,
          };
        });

      // Who has been handed a seat and not taken it. A GM could not see this
      // at all before: the lobby roster lives in the Game section, which is
      // superadmin-only because it also holds Start, End and Restart Game.
      // Being told "you are the Baroness" is the loudest thing the game says
      // to anybody, and nobody running the game could see who had been told.
      {
        const memberById = new Map(members.map((m) => [m.id, m]));
        seatsOut = openSeats.map((e) => {
          const m = memberById.get(e.discordUserId);
          return {
            discordUserId: e.discordUserId,
            handle: m ? m.globalName || m.username : e.discordUserId,
            roleName: e.assignedRole?.name ?? "—",
            assignedAt: e.assignedAt ? e.assignedAt.toISOString() : null,
            expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
            reminded: Boolean(e.reminderSentAt),
          };
        });
      }

      // Seats left per role, so the spawn dialog says which are open rather
      // than letting an accept fail on a full one.
      const taken = await prisma.character.groupBy({
        by: ["roleId", "status"],
        _count: { _all: true },
      });
      // Spawn-only roles stay IN this list but are flagged rather than
      // dropped: a seat that pins its own role (the Tribunal's two) looks
      // itself up here by slug, so filtering them out would leave the dialog
      // unable to name the role it is pinned to. The dialog hides the flagged
      // ones from the cover-role dropdown instead — a Thanati handed the
      // Tribunal Ordinator as cover was DMed its nuclear briefing.
      spawnRoles = roles.map((role) => {
        const holders = seatHolderStatuses(role);
        const used = taken
          .filter((t) => t.roleId === role.id && holders.includes(t.status))
          .reduce((n, t) => n + t._count._all, 0);
        const cap = roleCapacity(role, effectivePlayerCount(config, state));
        return {
          id: role.id,
          slug: role.slug,
          name: role.name,
          spawnOnly: isSpawnOnly(role),
          startingLocationId: role.startingLocationId,
          seatsLeft: cap === Infinity ? "\u221e" : Math.max(0, cap - used),
        };
      });

      spawnLocations = locationRows.map((l) => ({ id: l.id, name: l.name, zoneName: l.zone?.name ?? "" }));
      break;
    }
    case "antagonists": {
      const [heldSeats, offers, members, objectives, pickableCharacters, allLocations] = await Promise.all([
        // Who holds a seat, read off the seat tag itself. No column to keep in
        // sync, and it stays right however the tag was granted.
        prisma.characterTag.findMany({
          where: { tag: { slug: { in: SEAT_TAG_SLUGS } } },
          select: {
            acquiredAt: true,
            tag: { select: { slug: true } },
            character: {
              select: {
                id: true,
                name: true,
                discordUserId: true,
                status: true,
                resources: true,
                tagPoints: true,
                location: { select: { name: true } },
                zone: { select: { name: true } },
              },
            },
          },
        }),
        prisma.threatSpawn.findMany({
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            discordUserId: true,
            threatSlug: true,
            createdAt: true,
            role: { select: { name: true } },
            location: { select: { name: true } },
          },
        }),
        listGuildMembers(),
        listObjectives(prisma, { state }),
        // The Add row's pickers: living characters, with what the leader and
        // Inquisitor-or-Baron kinds filter on.
        prisma.character.findMany({
          where: { status: "ALIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true, roleTitle: true, role: { select: { slug: true, requiresWhitelist: true } } },
        }),
        prisma.location.findMany({
          orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
          select: { id: true, name: true, attributes: true, zone: { select: { name: true, kind: true } } },
        }),
      ]);

      const handleFor = new Map(members.map((m) => [m.id, m.globalName || m.username]));
      seatRows = heldSeats
        .map((row) => {
          const threat = threatBySeatTag(row.tag.slug);
          if (!threat || !row.character) return null;
          return {
            threatSlug: threat.slug,
            threatName: threat.name,
            characterId: row.character.id,
            characterName: row.character.name,
            handle: handleFor.get(row.character.discordUserId) ?? "left the guild",
            status: row.character.status,
            locationName: row.character.location?.name ?? null,
            zoneName: row.character.zone?.name ?? "",
            resources: row.character.resources,
            tagPoints: row.character.tagPoints,
            acquiredAt: row.acquiredAt.toISOString().slice(0, 10),
          };
        })
        .filter(Boolean);

      pendingSpawns = offers.map((o) => ({
        id: o.id,
        threatName: threatBySlug(o.threatSlug)?.name ?? o.threatSlug,
        handle: handleFor.get(o.discordUserId) ?? o.discordUserId,
        roleName: o.role?.name ?? "",
        locationName: o.location?.name ?? null,
        createdAt: o.createdAt.toISOString().slice(0, 16).replace("T", " "),
      }));

      // One card per party, seated or not. Members come from the same
      // derivation the reveal uses (db/lib/objectives.js#membersByParty), fed
      // the seat rows reshaped into characters-with-tags, so the card and the
      // Game Ended post can never disagree about who is in a party. Everything
      // is serialised flat — the panel is a client component.
      const seatHolders = new Map();
      for (const row of heldSeats) {
        if (!row.character) continue;
        const holder = seatHolders.get(row.character.id) ?? { id: row.character.id, name: row.character.name, tags: [] };
        holder.tags.push({ tag: { slug: row.tag.slug } });
        seatHolders.set(row.character.id, holder);
      }
      // The Thanati's rites, read-only (RitesPanel.js): this game's words —
      // rolled here if nothing has asked for them yet — and the attempts in
      // flight or lately finished, with who chanted.
      const [riteWords, attempts] = await Promise.all([
        ensureRiteWords(prisma),
        prisma.riteAttempt.findMany({
          where: { OR: [{ status: { in: ["OPEN", "READY"] } }, { firedAt: { not: null } }] },
          orderBy: { openedAt: "desc" },
          take: 40,
          include: { chants: { select: { characterId: true, characterName: true } } },
        }),
      ]);
      riteWordRows = RITES.map((r) => ({ key: r.key, name: r.name, minChanters: r.minChanters, phrase: riteWords[r.key] ?? "" }));
      const stamp = (d) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : null);
      riteAttemptRows = attempts.map((a) => ({
        id: a.id,
        riteName: riteByKey(a.riteKey)?.name ?? a.riteKey,
        roomName: a.roomName,
        status: a.status,
        chanters: [...new Map(a.chants.map((c) => [c.characterId, c.characterName])).values()],
        // An effect that threw, or what a re-armed attempt was missing.
        note: a.result?.error ? String(a.result.error) : Array.isArray(a.result?.rearmed) ? a.result.rearmed.join(", ") : null,
        openedAt: stamp(a.openedAt),
        firesAt: stamp(a.firesAt),
        firedAt: stamp(a.firedAt),
      }));

      const partyMembers = membersByParty([...seatHolders.values()]);
      objectiveParties = PARTIES.map((party) => {
        return {
          key: party.key,
          name: party.name,
          members: (partyMembers.get(party.key) ?? []).map(({ name, seat }) => ({ name, seat })),
          objectives: objectives
            .filter((o) => o.partyKey === party.key)
            .map((o) => ({
              id: o.id,
              description: o.description,
              weight: o.weight,
              done: o.done,
              source: o.source,
              scripted: o.scripted,
              placeholder: o.placeholder,
            })),
          kinds: kindsForParty(party.key).map((k) => ({
            key: k.key,
            pick: k.pick,
            target: k.target,
            defaultValue: k.defaultValue ?? null,
          })),
          hasStandardSet: Boolean(PARTY_DEFAULTS[party.key]?.length),
        };
      });
      objectiveCharacters = pickableCharacters.map((c) => ({
        id: c.id,
        name: c.name,
        roleTitle: c.roleTitle,
        leader: Boolean(c.role?.requiresWhitelist),
        inquisitorOrBaron: INQUISITOR_OR_BARON_ROLE_SLUGS.has(c.role?.slug),
      }));
      // Grouped here with the same helper Bulk move uses, so the client only
      // renders optgroups.
      objectiveLocations = groupLocationsByZone(allLocations.filter(locationEligible)).map((g) => ({
        zoneName: g.zoneName ?? "",
        locations: g.locations.map((l) => ({ id: l.id, name: l.name })),
      }));
      break;
    }
    default:
      break;
  }

  return (
    <div className="desk-shell">
      <DeskHeader
        title="Dev Panel"
        meta={
          <>
            <DeskTurnChip turn={openTurnRecord} />
            <LockChip />
          </>
        }
      />
      <div className="desk-body desk-body--ops">
        <OpsNav section={section} tier={tier} />
        <main className="ops-main">
          {section === "game" ? (
            <div className="flex flex-col gap-8">
              <section className="ops-section">
                <div className="ops-section-head">
                  <h2 className="section-title">Game</h2>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusPill tone={PHASE_TONE[state.phase]}>{PHASE_LABEL[state.phase]}</StatusPill>
                  {state.game?.id ? <span className="chip mono">{shortId(state.game)}</span> : null}
                  {state.lobbyOpenedAt ? (
                    <span className="text-xs text-muted">Lobby opened {stamp(state.lobbyOpenedAt)}</span>
                  ) : null}
                  {state.startedAt ? <span className="text-xs text-muted">Started {stamp(state.startedAt)}</span> : null}
                  {state.endedAt ? <span className="text-xs text-muted">Ended {stamp(state.endedAt)}</span> : null}
                  {state.playerCount != null ? (
                    <span className="text-xs text-muted">Player count {state.playerCount}</span>
                  ) : null}
                </div>
                <GameControls phase={state.phase} readyCount={readyCount} hasDraft={Boolean(state.assignmentDraft)} />
                {state.closingNote ? (
                  <p className="ops-lede">
                    » <em>{state.closingNote}</em>
                  </p>
                ) : null}
              </section>

              {state.phase === "LOBBY" || (state.phase === "CLOSED" && readyCount > 0) ? (
                <section className="ops-section ops-section--wide">
                  <div className="ops-section-head">
                    <h2 className="section-title">Preview</h2>
                  </div>
                  <AssignmentPreview draft={state.assignmentDraft} rows={draftRows} roles={pickableRoles} />
                </section>
              ) : null}

              <section className="ops-section ops-section--wide">
                <div className="ops-section-head">
                  <h2 className="section-title">Lobby</h2>
                </div>
                <LobbyRoster rows={lobbyRows} started={state.phase === "RUNNING" || state.phase === "ENDED"} />
              </section>

              <section className="ops-section">
                <div className="ops-section-head">
                  <h2 className="section-title">The world</h2>
                </div>
                <form action={updateWorldState} className="flex flex-wrap items-end gap-3">
                  <div className="field">
                    <label htmlFor="world-lifewebBlood" className="field-label">
                      Lifeweb Blood
                    </label>
                    <input
                      type="number"
                      id="world-lifewebBlood"
                      name="lifewebBlood"
                      min="0"
                      max="100"
                      defaultValue={state.lifewebBlood}
                      className="max-w-24"
                    />
                  </div>
                  <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
                </form>
              </section>
            </div>
          ) : null}

          {section === "games" ? (
            <div className="flex flex-col gap-8">
              <section className="ops-section ops-section--wide">
                <div className="ops-section-head">
                  <h2 className="section-title">Games</h2>
                </div>
                <PastGames games={pastGames} currentGameId={state.gameId} archiveCounts={archiveCounts} />
              </section>
            </div>
          ) : null}

          {section === "turn" ? (
            <div className="flex flex-col gap-8">
              <section className="ops-section">
                <div className="ops-section-head">
                  <h2 className="section-title">Current Turn</h2>
                  <p className="ops-lede">
                    {openTurnRecord ? `${describeTurn(openTurnRecord).label} — OPEN` : "No turn is currently open."}
                  </p>
                </div>

                <form action={updateCurrentTurn} className="flex flex-wrap items-end gap-3">
                  <label className="field">
                    <span className="field-label">Day</span>
                    <input type="number" name="day" min="1" defaultValue={currentDay} className="max-w-24" />
                  </label>
                  <label className="field">
                    <span className="field-label">Phase</span>
                    <Select name="phase" defaultValue={currentPhase}>
                      <option value="DAWN">DAWN</option>
                      <option value="DUSK">DUSK</option>
                    </Select>
                  </label>
                  <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
                </form>

                {state.phase === "RUNNING" ? (
                  <EndTurnButton turnLabel={openTurnRecord ? describeTurn(openTurnRecord).label : null} />
                ) : (
                  null
                )}

              </section>

              <section className="ops-section">
                <div className="ops-section-head">
                  <h2 className="section-title">Next Turn</h2>
                  <p className="ops-lede">
                    {state.nextTurnNote ? `Note ready for the next turn: "${state.nextTurnNote}"` : "No note set for the next turn."}
                  </p>
                </div>
                <form action={updateNextTurn} className="flex flex-col gap-3">
                  <label className="field">
                    <span className="field-label">Note (optional)</span>
                    <textarea name="note" defaultValue={state.nextTurnNote ?? ""} rows={2} />
                  </label>
                  <div className="ops-actions">
                    <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
                  </div>
                </form>
              </section>
            </div>
          ) : null}

          {section === "config" ? (
            <section className="ops-section">
              <div className="ops-section-head">
                <h2 className="section-title">Configuration</h2>
              </div>
              <ConfigForm config={config} />
            </section>
          ) : null}

          {section === "oracle" ? (
            <section className="ops-section">
              <div className="ops-section-head">
                <h2 className="section-title">Oracle</h2>
              </div>
              <OracleForm settings={await loadOracleSettings()} />
            </section>
          ) : null}

          {section === "depot" ? (
            <section className="ops-section">
              <div className="ops-section-head">
                <h2 className="section-title">The Depot</h2>
              </div>
              <form action={updateDepot} className="flex flex-col gap-4">
                <div className="ops-grid">
                  <DepotField
                    name="accountObols"
                    label="Account (¢)"
                    value={depot.accountObols}
                  />
                  <DepotField
                    name="debtObols"
                    label="Drawn on the line (¢)"
                    value={depot.debtObols}
                  />
                  <DepotField
                    name="generatorFuel"
                    label="Fuel in the tank"
                    value={depot.generatorFuel}
                  />
                </div>

                <div className="ops-toggles">
                  <div className="ops-toggle">
                    <Switch name="generatorOn" defaultChecked={depot.generatorOn}>
                      Generator running
                    </Switch>
                  </div>
                  <div className="ops-toggle">
                    <Switch name="turretArmed" defaultChecked={depot.turretArmed}>
                      Turret armed
                    </Switch>
                  </div>
                </div>

                <div className="ops-grid">
                  <DepotField name="fuelMax" label="Tank size" value={depot.fuelMax} />
                  <DepotField
                    name="fuelBurnPerTurn"
                    label="Fuel burned per turn"
                    value={depot.fuelBurnPerTurn}
                  />
                  <DepotField name="coalFuel" label="Fuel per Coal" value={depot.coalFuel} />
                  <DepotField
                    name="saltpeterFuel"
                    label="Fuel per Saltpeter"
                    value={depot.saltpeterFuel}
                  />
                  <DepotField
                    name="shuttleMaxTurns"
                    label="Shuttle stays (turns)"
                    value={depot.shuttleMaxTurns}
                  />
                  <DepotField
                    name="shuttleCooldown"
                    label="Shuttle cooldown (turns)"
                    value={depot.shuttleCooldown}
                  />
                  <DepotField
                    name="creditCapObols"
                    label="Credit cap (¢)"
                    value={depot.creditCapObols}
                  />
                </div>

                <div className="ops-actions">
                  <SubmitButton pendingLabel="Saving…">Save the Depot</SubmitButton>
                </div>
              </form>
            </section>
          ) : null}

          {section === "bulk" ? (
            <section className="ops-section ops-section--wide">
              <div className="ops-section-head">
                <h2 className="section-title">Bulk actions</h2>
                <p className="ops-lede">
                  Raw edits to many sheets at once. Nothing here costs a Move, an Action or a
                  point, and nothing here can be undone — the audit log is the only record.
                </p>
              </div>
              <BulkActions
                characters={bulkCharacters}
                locations={groupLocationsByZone(locations).map((g) => ({
                  zoneName: g.zoneName ?? "Unzoned",
                  locations: g.locations.map((l) => ({ id: l.id, name: l.name })),
                }))}
                tags={bulkTags}
              />
            </section>
          ) : null}

          {section === "quests" ? (
            <section className="ops-section ops-section--wide">
              <div className="ops-section-head">
                <h2 className="section-title">Quests</h2>
                <p className="ops-lede">
                  Somewhere to go and something to try. A quest is a room you put anywhere —
                  usually in the caves — with one button on it: pressing Interact spends the
                  presser&apos;s Move for the turn as a Gambit. Below it are every noticeboard in
                  the game and a line into any zone, because staging a thing is only half of it.
                </p>
              </div>
              <QuestsSection
                quests={questRows}
                locations={questLocations}
                tags={questTags}
                characters={questCharacters}
                boards={questBoards}
                zones={questZones}
                canDelete={isMaster}
              />
            </section>
          ) : null}

          {section === "ambient" ? (
            <section className="ops-section ops-section--wide">
              <div className="ops-section-head">
                <h2 className="section-title">Say something</h2>
                <p className="ops-lede">
                  A line the world says — a gate closing, a smell, a noise far back in the dark.
                  It arrives as subtext, so it sits under the scene rather than interrupting it.
                </p>
              </div>
              <AmbientForm zones={ambientZones} locations={ambientLocations} rooms={ambientRooms} />
            </section>
          ) : null}

          {section === "letters" ? (
            <section className="ops-section">
              <div className="ops-section-head">
                <h2 className="section-title">Send a Letter</h2>
              </div>
              <SendLetterForm characters={livingCharacters} />
            </section>
          ) : null}

          {section === "reports" ? (
            <section className="ops-section">
              {/* Only on screen when there is something to say. A permanent
                  "no nuke armed" panel would be furniture on every other day
                  of the game. */}
              {(state.nukeArmedTurn != null || state.game?.nukeDetonatedTurn != null) && (
                <div className="ops-section-head">
                  <h2 className="section-title">The device</h2>
                  {state.game?.nukeDetonatedTurn != null ? (
                    <p className="ops-lede">
                      It went off at the close of turn {state.game?.nukeDetonatedTurn}.
                    </p>
                  ) : (
                    <>
                      <p className="ops-lede">
                        <strong>Armed.</strong> It detonates at the close of turn{" "}
                        {state.nukeArmedTurn}.
                      </p>
                      <form action={defuseNukeAction}>
                        <SubmitButton className="btn-secondary" pendingLabel="Defusing…">
                          Defuse
                        </SubmitButton>
                      </form>
                    </>
                  )}
                </div>
              )}

              {/* Same rule as the device: on screen only while there is
                  something to say about it. */}
              {(state.ascensionArmedTurn != null || state.game?.ascensionFiredTurn != null) && (
                <div className="ops-section-head">
                  <h2 className="section-title">The cult&rsquo;s countdown</h2>
                  {state.game?.ascensionFiredTurn != null ? (
                    <p className="ops-lede">
                      Ravenheart burned at the close of turn {state.game?.ascensionFiredTurn}.
                    </p>
                  ) : (
                    <>
                      <p className="ops-lede">
                        <strong>Running.</strong> Ravenheart burns at the close of turn{" "}
                        {state.ascensionArmedTurn}, unless the cult leader is killed first.
                      </p>
                      <form action={cancelAscensionAction}>
                        <SubmitButton className="btn-secondary" pendingLabel="Calling it off…">
                          Call it off
                        </SubmitButton>
                      </form>
                    </>
                  )}
                </div>
              )}

              <div className="ops-section-head">
                <h2 className="section-title">Who has gone quiet</h2>
                <p className="ops-lede">
                  Living characters who left the guild, never registered any activity, or have not
                  been seen since day one. Read-only until you send something.
                </p>
              </div>
              <InactivePanel rows={inactiveList} turn={inactiveTurn} />

              <div className="ops-section-head">
                <h2 className="section-title">System Reports</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <form action={runDoctorAction}>
                  <input type="hidden" name="mode" value="check" />
                  <input type="hidden" name="scope" value="full" />
                  <SubmitButton className="btn-secondary" pendingLabel="Starting…">Run channel doctor (dry)</SubmitButton>
                </form>
                {/* Repair rewrites the guild, so it stays with the host. The
                    action re-checks the posted mode — hiding the button is a
                    hint, not a lock. */}
                {isMaster ? (
                  <form action={runDoctorAction}>
                    <input type="hidden" name="mode" value="repair" />
                    <input type="hidden" name="scope" value="full" />
                    <SubmitButton className="btn-secondary" pendingLabel="Starting…">Repair</SubmitButton>
                  </form>
                ) : null}
              </div>
              {/* The Discord mirror, still read-only. Host access, like Repair
                  above it: the panel it previews is the one that will rewrite
                  the guild in Phase 1, and the action re-checks the tier. */}
              {isMaster ? (
                <>
                  <div className="ops-section-head">
                    <h2 className="section-title">Discord mirror</h2>
                  </div>
                  <MirrorPreview />
                </>
              ) : null}

              <div>
                {[...latestByKind.values()].map((report) => (
                  <div key={report.id} className="ops-report">
                    <div className="ops-report-head">
                      <strong>{report.kind}</strong>
                      <StatusPill tone={reportTone(report)}>{reportLabel(report)}</StatusPill>
                      <span className="mono text-xs text-muted">
                        {report.startedAt.toISOString().slice(0, 16).replace("T", " ")}
                      </span>
                    </div>
                    {report.summary && Object.keys(report.summary).length > 0 ? (
                      <p className="ops-report-detail mono">{JSON.stringify(summaryHead(report.summary))}</p>
                    ) : null}
                    {slowestSteps(report.summary).length > 0 ? (
                      <ul className="ops-report-detail mono">
                        {slowestSteps(report.summary).map((step) => (
                          <li key={step.name}>
                            {Math.round(step.elapsedMs / 1000)}s · {step.requests} req · {step.name}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {Array.isArray(report.failures) && report.failures.length > 0 ? (
                      <ul className="text-xs list-disc pl-5">
                        {report.failures.slice(0, 25).map((f, i) => (
                          <li key={i}>
                            {[f.check ?? f.step, f.target].filter(Boolean).join(" · ")}: {f.message}
                          </li>
                        ))}
                        {report.failures.length > 25 ? (
                          <li className="text-muted">…and {report.failures.length - 25} more.</li>
                        ) : null}
                      </ul>
                    ) : null}
                  </div>
                ))}
                {latestByKind.size === 0 ? <EmptyState>Nothing has reported yet.</EmptyState> : null}
              </div>
            </section>
          ) : null}

          {section === "gamemasters" ? (
            <section className="ops-section ops-section--wide">
              <div className="ops-section-head">
                <h2 className="section-title">Gamemasters</h2>
              </div>
              {/* Flattened to plain rows here so the table itself is a client
                  leaf on the shared engine — this page stays a server
                  component. */}
              <GmRosterTable
                rows={gmRoster.map((m) => ({
                  id: m.id,
                  name: m.globalName ?? m.username,
                  handle: m.globalName ? m.username : null,
                  avatar: m.avatar,
                  standing: gmStanding(m).label,
                  tone: gmStanding(m).tone,
                  master: isSuperadmin(m.id),
                  characterId: gmCharacterByUserId.get(m.id)?.id ?? null,
                  characterName: gmCharacterByUserId.get(m.id)?.name ?? null,
                }))}
              />
            </section>
          ) : null}

          {section === "assignments" ? (
            <>
            <section className="ops-section ops-section--wide">
              <div className="ops-section-head">
                <h2 className="section-title">Seats out</h2>
              </div>
              <SeatsOut rows={seatsOut} />
            </section>

            <section className="ops-section ops-section--wide">
              <div className="ops-section-head">
                <h2 className="section-title">Assignments</h2>
              </div>
              <ThreatAssignmentsTable
                rows={assignmentRows}
                threats={THREAT_SUMMARY}
                roles={spawnRoles}
                locations={spawnLocations}
              />
            </section>
            </>
          ) : null}

          {section === "antagonists" ? (
            <section className="ops-section ops-section--wide">
              <div className="ops-section-head">
                <h2 className="section-title">Antagonists</h2>
                <div className="flex flex-wrap gap-2">
                  {antagonistGlance(seatRows, objectiveParties, riteAttemptRows).map((line) => (
                    <span key={line} className="chip mono">
                      {line}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="section-title">Seats</h3>
                <ThreatRosterTable
                  rows={seatRows}
                  pending={pendingSpawns}
                  threats={ASSIGNABLE_SUMMARY}
                />
              </div>

              <ObjectivesPanel
                parties={objectiveParties}
                characters={objectiveCharacters}
                locations={objectiveLocations}
                weights={OBJECTIVE_WEIGHTS}
                ended={state.phase === "ENDED"}
              />

              <RitesPanel words={riteWordRows} attempts={riteAttemptRows} />
            </section>
          ) : null}

          {section === "danger" ? (
            <section className="ops-section">
              {/* Every other section on this panel opens with one — without
                  it the Danger section began with a card and read as somebody
                  else's page. */}
              <div className="ops-section-head">
                <h2 className="section-title">Archive &amp; restart</h2>
              </div>
              <div className="desk-card flex flex-col gap-3">
                <h3 className="section-title">Archive this game</h3>
                <p className="ops-lede">
                  Writes the whole transcript out as one file and checks it can be read back. Deletes nothing, and
                  safe to press twice. Restart Game will not keep a game that has not been through here.
                </p>
                <ArchiveGameButton
                  exportKey={state?.game?.exportKey ?? null}
                  entryCount={state?.game?.entryCount ?? null}
                />
              </div>

              <div className="desk-card panel-danger flex flex-col gap-3">
                <h3 className="section-title">Restart Game</h3>
                <p className="ops-lede">Wipes all game data and reopens Turn 1. Cannot be undone.</p>
                <WipeGameButton hasPacket={Boolean(state?.game?.exportKey)} />
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}


// Locations arrive ordered by zone then sortOrder, so one pass builds the
// <optgroup> list in docs/zones.yaml order.
function groupLocationsByZone(locations) {
  const groups = [];
  for (const l of locations ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.zoneId === l.zoneId) last.locations.push(l);
    else groups.push({ zoneId: l.zoneId, zoneName: l.zone?.name ?? null, locations: [l] });
  }
  return groups;
}

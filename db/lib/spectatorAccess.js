// The spectator role — an observer seat that sees every Location channel, #turns and the narrowcast channels, read-only, WHILE THE GAME IS ON.
// "On" is GameState.phase RUNNING or ENDED (docs/systemdocs/LOBBY.md §1); during CLOSED and LOBBY the seat is denied view outright, so a GM testing
// the world before launch pings nobody who only came to watch. The overwrite is ALWAYS present on a managed channel and only its bits change with
// the phase, so the ordinary reconcile can carry it without adding or stripping a target. Applied at provisioning, re-asserted by every spec-driven
// reconcile, and swept on every phase transition by syncSpectatorAccess below. The deny list is wider than SendMessages: ViewChannel alone still
// leaves a forum channel postable and a thread writable, so the thread perms are denied explicitly.
const { putChannelOverwrite, getGuildChannels } = require("./discordRest");
const { SPECTATOR_ROLE_ID } = require("./roleIds");
const { SPECIAL_CHANNELS } = require("./specialChannels");

const PERM_VIEW_CHANNEL = 1024n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ADD_REACTIONS = 64n;
const PERM_ATTACH_FILES = 32768n;
const PERM_MANAGE_MESSAGES = 8192n;
const PERM_CREATE_PUBLIC_THREADS = 34359738368n;
const PERM_CREATE_PRIVATE_THREADS = 68719476736n;
const PERM_SEND_MESSAGES_IN_THREADS = 274877906944n;

const SPECTATOR_ALLOW = PERM_VIEW_CHANNEL;
const SPECTATOR_DENY =
  PERM_SEND_MESSAGES |
  PERM_ADD_REACTIONS |
  PERM_ATTACH_FILES |
  PERM_MANAGE_MESSAGES |
  PERM_CREATE_PUBLIC_THREADS |
  PERM_CREATE_PRIVATE_THREADS |
  PERM_SEND_MESSAGES_IN_THREADS;

function spectatorsVisible(phase) {
  return phase === "RUNNING" || phase === "ENDED";
}

async function spectatorsVisibleNow(db) {
  const state = await db.gameState.findUnique({ where: { id: 1 }, select: { phase: true } });
  return spectatorsVisible(state?.phase);
}

// The bits for one phase. Hidden is not "no overwrite": it's an explicit deny of View, so a channel whose @everyone somehow allows view still hides.
function spectatorBits(visible) {
  return visible
    ? { allow: SPECTATOR_ALLOW.toString(), deny: SPECTATOR_DENY.toString() }
    : { allow: "0", deny: (SPECTATOR_DENY | PERM_VIEW_CHANNEL).toString() };
}

// The overwrite object for inlining into a createChannel() permission_overwrites array at provisioning time.
function spectatorOverwrite({ visible = true } = {}) {
  return [{ id: SPECTATOR_ROLE_ID, type: 0, ...spectatorBits(visible) }];
}

// The REST equivalent, for channels that already exist. A single PUT that updates just this one overwrite without disturbing the channel's others.
async function applySpectatorOverwrite(channelId, { visible = true } = {}) {
  if (!channelId) return false;
  await putChannelOverwrite(channelId, SPECTATOR_ROLE_ID, spectatorBits(visible));
  return true;
}

// Every channel the seat is managed on. Read off the DB's own pointers, never guessed from names.
async function managedSpectatorChannels(db) {
  const [zones, locations, config] = await Promise.all([
    db.zone.findMany({ select: { name: true, discordCategoryId: true, discordSummaryChannelId: true } }),
    db.location.findMany({ select: { name: true, discordChannelId: true } }),
    db.gameConfig.findUnique({
      where: { id: 1 },
      select: {
        turnsConsoleChannelId: true,
        ...Object.fromEntries(SPECIAL_CHANNELS.map((c) => [c.configKey, true])),
      },
    }),
  ]);
  const out = [];
  for (const z of zones) {
    if (z.discordCategoryId) out.push({ id: z.discordCategoryId, label: `${z.name}/category` });
    if (z.discordSummaryChannelId) out.push({ id: z.discordSummaryChannelId, label: `${z.name}/summary` });
  }
  for (const l of locations) if (l.discordChannelId) out.push({ id: l.discordChannelId, label: l.name });
  if (config?.turnsConsoleChannelId) out.push({ id: config.turnsConsoleChannelId, label: "#turns" });
  // Walked, not hand-listed, so a new special channel is zero-touch here.
  for (const entry of SPECIAL_CHANNELS) {
    const id = config?.[entry.configKey];
    if (id) out.push({ id, label: `#${entry.slug}` });
  }
  return out;
}

// Which managed channels carry the wrong bits for `visible`. Pure over its inputs so the doctor can diff without a second fetch.
function spectatorDrift(managed, liveChannels, visible) {
  const want = spectatorBits(visible);
  const liveById = new Map(liveChannels.map((c) => [c.id, c]));
  const drifted = [];
  for (const target of managed) {
    const live = liveById.get(target.id);
    if (!live) continue; // a dead pointer is the doctor's structural checks' business
    const o = (live.permission_overwrites ?? []).find((x) => x.id === SPECTATOR_ROLE_ID);
    if (!o || (o.allow ?? "0") !== want.allow || (o.deny ?? "0") !== want.deny) drifted.push(target);
  }
  return drifted;
}

// The sweep run on every phase transition: PUTs only where the live bits differ.
async function syncSpectatorAccess(db) {
  const [visible, managed, live] = await Promise.all([
    spectatorsVisibleNow(db),
    managedSpectatorChannels(db),
    getGuildChannels(),
  ]);
  const drifted = spectatorDrift(managed, live, visible);
  for (const target of drifted) {
    await applySpectatorOverwrite(target.id, { visible }).catch((err) =>
      console.error(`Spectator overwrite failed on ${target.label}:`, err),
    );
  }
  return { visible, checked: managed.length, changed: drifted.length };
}

module.exports = {
  spectatorsVisible,
  spectatorsVisibleNow,
  spectatorOverwrite,
  applySpectatorOverwrite,
  managedSpectatorChannels,
  spectatorDrift,
  syncSpectatorAccess,
};

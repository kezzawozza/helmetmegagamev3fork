// Desired x live x the ids the database already records, turned into an
// ordered list of ops.
//
// An op is `{ order, kind, targetType, targetId, reason, run }`. `reason` is
// the sentence a GM reads on /gm/dev; `run` is the thunk apply.js calls. A dry
// run never calls one, which is why the whole module can be tested with fixture
// rows and no guild at all.
//
// THE RULE THAT MAKES THIS SAFE TO KILL HALFWAY THROUGH: adopt by name before
// creating. If the database has no id but Discord already holds an object with
// the right name in the right place, that object IS the one we meant — record
// its id and create nothing. Without it, a run that died after the Discord POST
// and before the database UPDATE would cut a second copy of everything on the
// next pass. Two matches is the case nobody can guess at, so it becomes a
// `mirror-ambiguous` finding and no create.
const { channelKey, threadKey } = require("./live");
const { ORDER } = require("./desired");

// A finding, in the channel doctor's shape, so /gm/dev can render both.
function finding(check, target, problem) {
  return { check, target, problem, repaired: false, error: null };
}

function overwritesEqual(want = [], live = []) {
  const liveById = new Map((live ?? []).map((o) => [o.id, o]));
  for (const o of want) {
    const there = liveById.get(o.id);
    if (!there) return false;
    if (String(there.allow ?? "0") !== String(o.allow ?? "0")) return false;
    if (String(there.deny ?? "0") !== String(o.deny ?? "0")) return false;
  }
  return true;
}

// Only the keys the spec actually names are compared: a channel carries plenty
// the mirror has no opinion about.
function propertyDrift(want = {}, live = {}) {
  const drift = {};
  for (const [key, value] of Object.entries(want)) {
    if (value === undefined) continue;
    const there = live?.[key];
    // A topic Discord never had reads back as null, and the spec writes "" for
    // a Location with no description. Those are the same thing.
    const same = key === "topic" ? String(there ?? "") === String(value ?? "") : there === value;
    if (!same) drift[key] = value;
  }
  return drift;
}

function buildOps({ desired, live, prisma, scope = "structure", writes = null }) {
  const ops = [];
  const findings = [];
  // Ids handed out during THIS diff — an adopt earlier in the list is what a
  // later target's parent lookup has to see, since nothing has been written yet.
  const resolvedIdByKey = new Map();
  // Every id the database already spends on a @unique column, so an adoption
  // that would collide is reported instead of thrown as a P2002 at write time.
  const claimedRoleIds = new Map();

  const writeId = writes?.writeId ?? defaultWriteId(prisma);

  for (const target of desired) {
    if (target.targetType === "role") {
      diffRole(target, { live, ops, findings, resolvedIdByKey, claimedRoleIds, writeId });
    } else if (target.targetType === "channel") {
      diffChannel(target, { live, ops, findings, resolvedIdByKey, writeId });
    } else if (target.targetType === "thread") {
      diffThread(target, { live, ops, findings, resolvedIdByKey });
    } else if (target.targetType === "anchor") {
      diffAnchor(target, { live, ops, findings, resolvedIdByKey });
    }
  }

  // Positions, one bulk PATCH, only when something actually drifted. `parent_id`
  // must NOT ride along in it — Discord answers 400 code 40009, "Only one
  // channel can have a parent_id modified at a time" — so reparents are their
  // own ops above, and they are ordered ahead of this one.
  const positions = [];
  for (const target of desired) {
    if (target.targetType !== "channel" || target.position == null) continue;
    const id = target.currentId ?? resolvedIdByKey.get(target.key);
    if (!id) continue;
    const there = live.channelsById.get(id);
    if (there && there.position !== target.position) positions.push({ id, position: target.position });
  }
  if (positions.length > 0) {
    ops.push({
      order: ORDER.POSITIONS,
      kind: "positions",
      targetType: "guild",
      targetId: null,
      reason: `${positions.length} channel(s) sit in the wrong order inside their category`,
      run: async () => {
        const { patchGuildChannelPositions } = require("../discordRest");
        await patchGuildChannelPositions(positions);
      },
    });
  }

  // The two halves the mirror deliberately does NOT reimplement. Both already
  // exist, both are correct, and both are per-member work that would double this
  // module's size for nothing. They are expressed as one delegate op each — in
  // a dry run they are listed and not run, which is exactly what the plan asks
  // Phase 0 to show.
  if (scope === "full") {
    ops.push({
      order: ORDER.OVERWRITES,
      kind: "delegate",
      targetType: "sweep",
      targetId: "overwrites",
      reason:
        "reconcile every zone, #summary and Location channel's standing overwrites " +
        "(syncZones/parse.js#reconcileChannelOverwrites, via the doctor's overwrites sweep)",
      run: null,
    });
    ops.push({
      order: ORDER.CHARACTER_ACCESS,
      kind: "delegate",
      targetType: "sweep",
      targetId: "locationOccupancy",
      reason: "reconcile per-character Location channel overwrites and zone role membership (the doctor's cheap sweeps)",
      run: null,
    });
    ops.push({
      order: ORDER.TURNS_ACCESS,
      kind: "delegate",
      targetType: "sweep",
      targetId: "turnsAccess",
      reason: "re-key #turns view grants onto the current zone roles (db/lib/turnsChannelAccess.js)",
      run: null,
    });
  }

  ops.sort((a, b) => a.order - b.order);
  return { ops, findings };
}

// --- roles -------------------------------------------------------------

function diffRole(target, { live, ops, findings, resolvedIdByKey, claimedRoleIds, writeId }) {
  const claim = (id) => {
    const already = claimedRoleIds.get(id);
    if (already && already !== target.key) {
      findings.push(
        finding(
          "mirror-collision",
          target.label,
          `role ${id} is already recorded on ${already} — Zone.discordRoleId and Zone.gmRoleId are @unique, so writing it here would fail`,
        ),
      );
      return false;
    }
    claimedRoleIds.set(id, target.key);
    return true;
  };

  if (target.currentId && live.rolesById.has(target.currentId)) {
    claim(target.currentId);
    resolvedIdByKey.set(target.key, target.currentId);
    return;
  }
  if (target.currentId) {
    findings.push(finding("mirror-missing", target.label, "the recorded role no longer exists in the guild"));
  }

  const matches = live.rolesByName.get(target.name) ?? [];
  if (matches.length > 1) {
    findings.push(
      finding("mirror-ambiguous", target.label, `${matches.length} guild roles are called "${target.name}" — refusing to guess, and creating nothing`),
    );
    return;
  }
  if (matches.length === 1) {
    if (!claim(matches[0].id)) return;
    resolvedIdByKey.set(target.key, matches[0].id);
    ops.push({
      order: target.order,
      kind: "adopt",
      targetType: "role",
      targetId: target.key,
      reason: `adopt the existing "${target.name}" role (${matches[0].id}) instead of creating a second one`,
      run: async () => writeId(target.idColumn, matches[0].id),
    });
    return;
  }

  ops.push({
    order: target.order,
    kind: "create",
    targetType: "role",
    targetId: target.key,
    reason: `create the "${target.name}" role`,
    run: async () => {
      const { createGuildRole } = require("../discordRest");
      const role = await createGuildRole(target.spec);
      await writeId(target.idColumn, role.id);
      return role.id;
    },
  });
}

// --- channels and categories -------------------------------------------

function diffChannel(target, { live, ops, findings, resolvedIdByKey, writeId }) {
  const parentId = target.parentKey
    ? resolvedIdByKey.get(target.parentKey) ?? target.parentId ?? null
    : null;

  let id = null;
  if (target.currentId && live.channelsById.has(target.currentId)) {
    id = target.currentId;
  } else {
    if (target.currentId) {
      findings.push(finding("mirror-missing", target.label, "the recorded channel no longer exists in the guild"));
    }
    const matches = live.channelsByKey.get(channelKey(target.discordType, parentId, target.name)) ?? [];
    if (matches.length > 1) {
      findings.push(
        finding("mirror-ambiguous", target.label, `${matches.length} channels are called "${target.name}" in the same place — refusing to guess, and creating nothing`),
      );
      return;
    }
    if (matches.length === 1) {
      id = matches[0].id;
      resolvedIdByKey.set(target.key, id);
      ops.push({
        order: target.order,
        kind: "adopt",
        targetType: "channel",
        targetId: target.key,
        reason: `adopt the existing "${target.name}" (${id}) instead of creating a second one`,
        run: async () => writeId(target.idColumn, id),
      });
      // Fall through: an adopted channel still gets its properties checked
      // against the live object below.
    } else {
      ops.push({
        order: target.order,
        kind: "create",
        targetType: "channel",
        targetId: target.key,
        reason: `create ${target.label}`,
        run: async () => {
          const { createChannel } = require("../discordRest");
          const created = await createChannel({ ...target.spec, ...(parentId ? { parent_id: parentId } : {}) });
          await writeId(target.idColumn, created.id);
          resolvedIdByKey.set(target.key, created.id);
          return created.id;
        },
      });
      return;
    }
  }

  resolvedIdByKey.set(target.key, id);
  const there = live.channelsById.get(id);
  if (!there) return;

  // Reparent, one PATCH of its own. See the 40009 note above the bulk position
  // op: these two can never be the same request.
  if (parentId && there.parent_id !== parentId) {
    ops.push({
      order: ORDER.REPARENT,
      kind: "reparent",
      targetType: "channel",
      targetId: target.key,
      reason: `${target.label} sits under the wrong category`,
      run: async () => {
        const { patchChannel } = require("../discordRest");
        await patchChannel(id, { parent_id: parentId });
      },
    });
  }

  const drift = propertyDrift(target.properties ?? {}, there);
  if (Object.keys(drift).length > 0) {
    ops.push({
      order: ORDER.PROPERTIES,
      kind: "patch",
      targetType: "channel",
      targetId: target.key,
      reason: `${target.label}: ${Object.keys(drift).join(", ")} drifted`,
      run: async () => {
        const { patchChannel } = require("../discordRest");
        await patchChannel(id, drift);
      },
    });
  }

  if (target.overwrites?.length && !overwritesEqual(target.overwrites, there.permission_overwrites)) {
    findings.push(finding("mirror-overwrites", target.label, "standing permission overwrites do not match the spec"));
  }
}

// --- Room threads ------------------------------------------------------

function diffThread(target, { live, ops, findings, resolvedIdByKey }) {
  const parentId = target.parentKey
    ? resolvedIdByKey.get(target.parentKey) ?? target.parentId ?? null
    : null;
  if (!parentId) {
    // No Location channel yet means the thread is a job for the NEXT run, once
    // the channel above it exists. Silent on purpose: the create op for that
    // channel is already in this list and says the same thing.
    return;
  }

  if (target.currentId && live.threadsById.has(target.currentId)) {
    if (target.currentHash === target.bodyHash && target.hasStarter) return;
    ops.push({
      order: target.order,
      kind: "rewrite",
      targetType: "thread",
      targetId: target.key,
      reason: `${target.label}: the room's starter post no longer matches the row`,
      run: null,
    });
    return;
  }

  if (!live.threadsFetched) {
    findings.push(finding("mirror-threads", target.label, "the active-thread snapshot failed, so this room was not checked"));
    return;
  }
  if (target.currentId) {
    // An ARCHIVED thread is not in the active snapshot, so this is a maybe, not
    // a verdict. syncRoomThread's own getChannel is what settles it at apply
    // time; the mirror only says the room needs a look.
    findings.push(finding("mirror-missing", target.label, "the recorded thread is not among the guild's active threads (it may just be archived)"));
  }

  const matches = live.threadsByKey.get(threadKey(parentId, target.name)) ?? [];
  if (matches.length > 1) {
    findings.push(
      finding("mirror-ambiguous", target.label, `${matches.length} threads called "${target.name}" hang under the same channel — refusing to guess, and creating nothing`),
    );
    return;
  }
  ops.push({
    order: target.order,
    kind: matches.length === 1 ? "adopt" : "create",
    targetType: "thread",
    targetId: target.key,
    reason:
      matches.length === 1
        ? `adopt the existing "${target.name}" thread (${matches[0].id}) and rewrite its starter`
        : `create the "${target.name}" thread`,
    run: null,
  });
}

// --- Location anchors --------------------------------------------------

function diffAnchor(target, { live, ops, resolvedIdByKey }) {
  const parentId = resolvedIdByKey.get(target.parentKey) ?? target.parentId ?? null;
  if (!parentId) return;
  if (target.currentId && target.currentHash === target.bodyHash) return;
  ops.push({
    order: target.order,
    kind: target.currentId ? "rewrite" : "create",
    targetType: "anchor",
    targetId: target.key,
    reason: target.currentId
      ? `${target.label}: the pinned anchor no longer matches the row`
      : `${target.label}: no pinned anchor`,
    run: null,
  });
}

// --- writing an adopted id back ----------------------------------------
//
// Generic on purpose: a desired object says which column holds its id, so
// adopting a Zone's category and adopting GameConfig's Deadchat channel are the
// same two lines.
function defaultWriteId(prisma) {
  return async ({ model, id, field }, value) => {
    if (!prisma) return;
    await prisma[model].update({ where: { id }, data: { [field]: value } });
  };
}

module.exports = { buildOps };

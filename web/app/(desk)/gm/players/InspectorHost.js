"use client";

import { useCallback, useMemo, useState } from "react";
import { useSelection } from "./selection";
import InspectorColumn from "@/app/components/InspectorColumn";
import useInspectorOverlay from "@/app/components/useInspectorOverlay";
import DevPanelModal from "@/app/components/DevPanelModal";
import usePins from "@/app/components/usePins";
import BulkComposer from "./BulkComposer";
import CanonTab from "./CanonTab";
import AdminNotes from "@/app/components/AdminNotes";
import GmZoneRail from "@/app/components/GmZoneRail";

// The player desk's half of the shared inspector (the other is
// /gm/turns/Workspace.js). Mounted by layout.js, so it survives every
// navigation inside the desk.
//
// Which person it shows is DERIVED, not stored: `segment`
// (selection.js, who the rail has open) points
// the inspector at whoever's conversation is open; `override` is the last
// person clicked in the inspector's own search/pin row, and is ignored once
// the route moves past the segment it was set under. All computed during
// render — no effect syncing state to a prop, which is what
// react-hooks/set-state-in-effect (an error in this repo) exists to catch.

export default function InspectorHost({
  selectableZones,
  visibleZoneIds,
  rows,
  stagedEffects,
  currentTurnNumber,
  bulkCharacters,
  tagCatalog,
}) {
  const segment = useSelection();
  const [override, setOverride] = useState(null); // { segment, value }
  const [cache, setCache] = useState(() => new Map());
  const [devPanel, setDevPanel] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const rowByUser = useMemo(() => new Map(rows.map((r) => [r.discordUserId, r])), [rows]);
  const rowByCharacter = useMemo(
    () => new Map(rows.filter((r) => r.characterId).map((r) => [r.characterId, r])),
    [rows],
  );

  const knownPinIdentities = useMemo(() => {
    const ids = new Set();
    for (const r of rows) {
      if (r.characterId) ids.add(`c:${r.characterId}`);
      if (r.discordUserId) ids.add(`u:${r.discordUserId}`);
    }
    return ids;
  }, [rows]);
  const { pins, togglePin } = usePins({ knownIdentities: knownPinIdentities });

  // The inspector can only show somebody who has a character sheet, so a
  // player-only ("u:") pin stays in the list for the rail and is skipped here.
  const pinned = useMemo(
    () =>
      pins
        .map((p) =>
          p.characterId ? rowByCharacter.get(p.characterId) : rowByUser.get(p.discordUserId),
        )
        .filter((r) => r?.characterId)
        .map((r) => ({ characterId: r.characterId, discordUserId: r.discordUserId, name: r.name })),
    [pins, rowByCharacter, rowByUser],
  );

  const fromSegment = segment ? (rowByUser.get(segment) ?? null) : null;
  const activeOverride = override && override.segment === segment ? override.value : null;
  const inspectedRow = activeOverride ?? fromSegment;
  const inspected = inspectedRow?.characterId
    ? {
        characterId: inspectedRow.characterId,
        discordUserId: inspectedRow.discordUserId,
        name: inspectedRow.name,
      }
    : null;

  // The third argument is an optional tab request — "look them up AND land on
  // that tab", the way the adjudication desk's "Past moves" button does it.
  // Token-stamped so the column can tell a fresh ask from the one it already
  // honoured.
  const [tabRequest, setTabRequest] = useState(null); // { tab, token }
  const { setOpen: setInspectorOpen } = useInspectorOverlay();
  const onInspect = useCallback(
    (characterId, name, tab) => {
      const row = rowByCharacter.get(characterId);
      if (row) setOverride({ segment, value: row });
      if (tab) setTabRequest((prev) => ({ tab, token: (prev?.token ?? 0) + 1 }));
      // Narrow tiers: the column is a closed overlay until something asks for
      // it. In an event handler, never an effect.
      setInspectorOpen(true);
    },
    [rowByCharacter, segment, setInspectorOpen],
  );

  const roster = useMemo(
    () =>
      rows
        .filter((r) => r.characterId)
        .map((r) => ({
          id: r.characterId,
          name: r.name,
          roleTitle: r.roleTitle,
          zoneName: r.zoneName,
          username: r.username,
        })),
    [rows],
  );

  // Same shape Workspace builds, so StagedDeltaFact dims and suffixes
  // identically on both desks.
  const pendingByCharacter = useMemo(() => {
    const map = new Map();
    for (const e of stagedEffects) {
      const entry = map.get(e.targetCharacterId) ?? {
        resources: 0,
        tagPoints: 0,
        removes: new Set(),
        adds: new Set(),
      };
      entry.resources += e.resources ?? 0;
      entry.tagPoints += e.tagPoints ?? 0;
      for (const op of e.tagOps ?? []) (op.op === "remove" ? entry.removes : entry.adds).add(op.tagId);
      map.set(e.targetCharacterId, entry);
    }
    return map;
  }, [stagedEffects]);

  // Canon is the one section the adjudication desk has no use for — there the
  // character is context for a Move; here the Move is context for a character.
  // It rides ABOVE the Moves tab rather than taking a tab of its own: this
  // turn, then everything before it, in the order a GM asks about them.
  const tabPreludes = useMemo(
    () => ({
      Moves: ({ inspected: who }) => (
        <CanonTab
          key={who.characterId}
          characterId={who.characterId}
          // Insert-into-reply writes the open conversation's draft, so it is
          // only offered when the inspected person IS the open conversation
          // — a pinned someone-else must not overwrite an unrelated draft.
          discordUserId={who.discordUserId === segment ? who.discordUserId : null}
        />
      ),
    }),
    [segment],
  );

  // The one tab this desk adds outright rather than as a prelude. It has no
  // base tab to sit above, and it must NOT take a slot in the shared
  // per-(character, tab) cache: notes are keyed on the PLAYER, so two
  // characters on one account share one list, and a cache keyed on the
  // character would hold two entries for it that could silently disagree. An
  // extra tab is skipped by that cache, so this is the right seam as well as
  // the only one. Keyed on the player for the same reason.
  const extraTabs = useMemo(
    () => ({
      "Notes": ({ inspected: who }) => (
        <AdminNotes key={who.discordUserId} discordUserId={who.discordUserId} />
      ),
    }),
    [],
  );

  // The custom-tag door. It APPLIES here rather than staging: this desk is a
  // conversation, not a push — a GM inventing a tag mid-reply means the
  // player has it. (The toggle is still offered, hence allowStage.)
  const customTag = useMemo(
    () => ({
      mode: "apply",
      categories: [...new Set((tagCatalog ?? []).map((t) => t.category))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
      tags: tagCatalog ?? [],
      groups: [
        ...new Map(
          (tagCatalog ?? [])
            .filter((t) => t.group?.id)
            .map((t) => [t.group.id, { id: t.group.id, name: t.group.name }]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    }),
    [tagCatalog],
  );

  // Where the desk stands, for the column with nobody picked. Counted off the
  // same `rows` the rail draws from, so the two can never disagree.
  const standing = useMemo(() => {
    const conversations = rows.filter((r) => r.hasConversation && !r.muted);
    const unread = conversations.filter((r) => r.unreadCount > 0).length;
    const awaiting = conversations.filter(
      (r) => r.unreadCount === 0 && r.lastDirection === "INBOUND" && !r.handled,
    ).length;
    const muted = rows.filter((r) => r.hasConversation && r.muted).length;
    return [
      { label: "Unread", value: unread, tone: unread ? "warn" : undefined },
      { label: "Awaiting a reply", value: awaiting, tone: awaiting ? "warn" : undefined },
      { label: "Conversations", value: conversations.length },
      { label: "Pinned", value: pinned.length },
      ...(muted ? [{ label: "Muted", value: muted }] : []),
    ];
  }, [rows, pinned]);

  const pinsActions =
    pinned.length > 0 ? (
      <button type="button" className="btn-quiet" onClick={() => setBulkOpen(true)}>
        Message pinned
      </button>
    ) : null;

  return (
    <>
      <InspectorColumn
        inspected={inspected}
        pinned={pinned}
        roster={roster}
        onInspect={onInspect}
        onTogglePin={togglePin}
        cache={cache}
        setCache={setCache}
        tagsById={{}}
        currentTurnNumber={currentTurnNumber}
        pendingByCharacter={pendingByCharacter}
        onOpenDev={(characterId, name) => setDevPanel({ characterId, name })}
        tabPreludes={tabPreludes}
        extraTabs={extraTabs}
        pinsActions={pinsActions}
        lookup={false}
        customTag={customTag}
        requestedTab={tabRequest}
        emptyStanding={standing}
        emptyHint="Pick somebody in the rail to keep their sheet beside the conversation."
        footer={<GmZoneRail zones={selectableZones} selectedIds={visibleZoneIds} />}
      />

      {bulkOpen && (
        <BulkComposer
          characters={bulkCharacters}
          initialSelectedIds={pinned.map((p) => p.characterId)}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {devPanel && (
        <DevPanelModal
          characterId={devPanel.characterId}
          name={devPanel.name}
          onClose={() => setDevPanel(null)}
        />
      )}
    </>
  );
}

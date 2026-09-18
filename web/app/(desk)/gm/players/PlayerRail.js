"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import DeskRail from "@/app/components/DeskRail";
import ZoneChip from "@/app/components/ZoneChip";
import { noteActionVersion } from "@/app/components/useDeskVersion";
import Select from "@/app/components/Select";
import usePins from "@/app/components/usePins";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import MatchHint from "@/app/components/MatchHint";
import { EnumPill, CHARACTER_STATUS } from "@/app/components/StatusPill";
import { scoreMatch } from "@/lib/fuzzySearch";
import useNowTick from "@/app/components/useNowTick";
import { mergeRailRows, useRailPatches, useReadOverrides } from "./liveInbox";
import { inVisibleZones } from "@/lib/zones";
import { useSelection, selectConversation } from "./selection";
import { useVisibleZoneNames } from "@/app/components/GmZoneViewProvider";
import {
  markConversationRead,
  setConversationHandled,
  setConversationMuted,
} from "./actions";

// The player desk's queue rail, on the same .desk-rail/.desk-queue-row classes
// as the adjudication desk's — the two are the same tool and should look it.
//
// One lens: the rail is the inbox. With no search query it lists only players
// with a conversation, sorted pinned → unread → recency, showing the last
// message. Typing a query widens the candidate set to everyone with a
// character too — that's what makes a first message possible at all — and
// pauses the zone and needs-reply filters, since the seat-seeded zone filter
// would otherwise silently hide a cross-zone search hit.

// The fuzzy engine only ever sees what the layout ships to the client, and
// that is one preview line per conversation — so "find the thread where we
// talked about the barley" could not work at all. Anything at least this long
// also goes to the server as an ILIKE over every message
// (/api/gm/conversation-search), debounced, and its hits are merged in
// UNDER the fuzzy ones: a name match is still what a GM usually means.
const CONTENT_SEARCH_MIN = 3;
const CONTENT_SEARCH_DEBOUNCE_MS = 300;

// The "why this row matched" hint for a tag hit: the tag names that contain a
// query word, not the whole sheet joined into one line.
function matchedTagNames(tagNames, query) {
  const words = query
    .toLowerCase()
    .replace(/^tag:/, "")
    .split(/\s+/)
    .filter(Boolean);
  const hits = (tagNames ?? []).filter((n) => words.some((w) => n.toLowerCase().includes(w)));
  const shown = (hits.length ? hits : tagNames ?? []).slice(0, 3);
  return shown.join(", ") + ((hits.length ? hits : tagNames ?? []).length > 3 ? ", …" : "");
}

function relativeTime(ms, now) {
  const diff = now - ms;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export default function PlayerRail({ rows: serverRows, rowsAsOfMs, visibleZoneNames, myDiscordUserId }) {
  const selected = useSelection();
  // The prop is only the seed: once the picker in the inspector has moved,
  // the live answer is in the client (GmZoneViewProvider), so the rail
  // re-filters on the click instead of waiting on a revalidate.
  const zonesInView = useVisibleZoneNames(visibleZoneNames);
  // The live inbox's patches laid over the layout's rows (liveInbox.js), so
  // a new message moves a row, bumps its badge and rewrites its preview
  // within seconds instead of on the next 30s refresh. Done FIRST, before
  // the ✓/⊘ overrides below look at a row: the ✓ override is keyed on the
  // row's last-message time, and it has to see the live one to un-stick
  // when a new message lands.
  const patches = useRailPatches();
  // And this GM's own "I have read that" marks over the top of those, applied
  // per field rather than as a whole row — see liveInbox.js#mergeRailRows.
  // Without them the badge on a conversation just read came back on the next
  // frame, because marking read deliberately revalidates nothing.
  const readOverrides = useReadOverrides();
  const rows = useMemo(
    () => mergeRailRows(serverRows, patches, rowsAsOfMs, readOverrides),
    [serverRows, patches, rowsAsOfMs, readOverrides],
  );

  // The zones this GM chose to see (null = all). Unlike the zone dropdown
  // below, this is not a lens: a row outside it is not theirs to work, and a
  // search does NOT lift it.
  const inView = useMemo(() => inVisibleZones(rows, zonesInView), [rows, zonesInView]);

  // A beat for the relative-time chips, so "just now" doesn't stay "just
  // now" for an hour.
  const now = useNowTick(30_000);
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  // "Who is waiting on me": unread, or they wrote last and it's been read.
  // A 100-player inbox still needs this one lens; it did not need three
  // mutually exclusive ones where two were sort orders in disguise.
  const [needsReplyOnly, setNeedsReplyOnly] = useState(false);
  // { q, hits } — kept keyed by the query it answered, so a stale round trip
  // is ignored during render rather than cleared from an effect (clearing
  // state in an effect body is what react-hooks/set-state-in-effect, an error
  // here, exists to catch). Clearing the box therefore drops the hits for
  // free: they simply stop matching the current query.
  const [contentHits, setContentHits] = useState(null);
  // Optimistic ✓ marks, so the glyph lights the instant it is clicked instead
  // of waiting on the revalidation. Keyed on the conversation's last-message
  // time as well as the id, so the entry stops matching — and the server's
  // answer takes back over — the moment a new message lands on that row.
  const [handledOverride, setHandledOverride] = useState({});
  // Muted conversations are out of the rail by default. This reveals them,
  // greyed, in place — hiding them outright is the point, but a GM still has
  // to be able to find someone they muted a week ago.
  const [showMuted, setShowMuted] = useState(false);
  // Same optimistic trick as the ✓, minus the timestamp in the key: a mute is
  // standing, so nothing about a new message should take it back.
  const [mutedOverride, setMutedOverride] = useState({});

  // A plain fetch, not a server action. An action would ride the router's
  // serial queue, so this scan — an ILIKE over every DirectMessage — would
  // hold up the very next thing the GM did, and "type a name, click the row"
  // is the most ordinary sequence on this desk. A GET is off that queue and
  // can be aborted, so a superseded search stops costing anything at once.
  useEffect(() => {
    const q = query.trim();
    if (q.length < CONTENT_SEARCH_MIN) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/gm/conversation-search?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        // 204 is "not a GM any more", and res.ok is TRUE for a 204 — so
        // without this the next line parses an empty body and throws into the
        // catch. Right outcome, wrong reason; say it on purpose.
        if (res.status === 204 || !res.ok) return;
        const data = await res.json();
        if (controller.signal.aborted) return;
        setContentHits({ q, hits: data.hits ?? [] });
      } catch {
        // Aborted by the next keystroke, or offline. The rail still filters on
        // name, role, faction, handle, zone and tag without this — content
        // hits only ever widen the result.
      }
    }, CONTENT_SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const activeContentHits =
    contentHits && contentHits.q === query.trim() ? contentHits.hits : null;

  // The player rail knows both id spaces — a character and/or a bare
  // discordUserId per row — so unlike the adjudication desk it can prune both
  // "c:" and "u:" pins, not just its own namespace.
  const knownPinIdentities = useMemo(() => {
    const ids = new Set();
    for (const r of inView) {
      if (r.characterId) ids.add(`c:${r.characterId}`);
      if (r.discordUserId) ids.add(`u:${r.discordUserId}`);
    }
    return ids;
  }, [inView]);
  const { isPinned, togglePin } = usePins({ knownIdentities: knownPinIdentities });

  const isHandled = useCallback(
    (row) => {
      const override = handledOverride[`${row.discordUserId}:${row.lastAtMs}`];
      return override === undefined ? Boolean(row.handled) : override;
    },
    [handledOverride],
  );

  function handledKey(row) {
    return `${row.discordUserId}:${row.lastAtMs}`;
  }

  const isMuted = useCallback(
    (row) => {
      const override = mutedOverride[row.discordUserId];
      return override === undefined ? Boolean(row.muted) : override;
    },
    [mutedOverride],
  );

  function toggleMuted(row) {
    const next = !isMuted(row);
    setMutedOverride((prev) => ({ ...prev, [row.discordUserId]: next }));
    startTransition(async () => {
      try {
        const res = noteActionVersion(
          await setConversationMuted({
            playerDiscordUserId: row.discordUserId,
            muted: next,
          }),
        );
        if (!res?.ok) {
          setMutedOverride((prev) => ({ ...prev, [row.discordUserId]: !next }));
        }
      } catch {
        // A throw is not a refusal — put the optimistic mark back and leave
        // the rail standing rather than letting it reach (desk)/error.js.
        setMutedOverride((prev) => ({ ...prev, [row.discordUserId]: !next }));
      }
    });
  }

  function toggleHandled(row) {
    const next = !isHandled(row);
    setHandledOverride((prev) => ({ ...prev, [handledKey(row)]: next }));
    startTransition(async () => {
      try {
        const res = noteActionVersion(
          await setConversationHandled({
            playerDiscordUserId: row.discordUserId,
            handled: next,
          }),
        );
        if (!res?.ok) {
          setHandledOverride((prev) => ({ ...prev, [handledKey(row)]: !next }));
        }
      } catch {
        setHandledOverride((prev) => ({ ...prev, [handledKey(row)]: !next }));
      }
    });
  }

  const zoneOptions = useMemo(
    () => [...new Set(inView.map((c) => c.zoneName).filter(Boolean))].sort(),
    [inView],
  );

  const visible = useMemo(() => {
    const q = query.trim();
    // With no query, the rail is the inbox: only players with a conversation,
    // where a conversation means somebody typed something. The game's own
    // notices don't count — a seat assignment or a hunger line can't put a
    // player in here (web/lib/dmThread.js#railKindSql).
    //
    // A query widens the net to everyone with a character, and past that to
    // anyone the game has written to at all. That last step is what keeps a
    // lobby entrant reachable: they have been DM'd their seat and nothing
    // else, so they have no character and no conversation, and their thread
    // href works fine the moment somebody navigates to it.
    let list = q ? inView : inView.filter((r) => r.hasConversation);

    // Unlike the zone and needs-reply filters, a query does NOT lift this one
    // on its own — a mute is a standing decision about a person, not a lens
    // over the inbox, so it takes the toggle to see them again.
    if (!showMuted) list = list.filter((r) => !isMuted(r));

    // A query pauses the zone and needs-reply filters rather than composing
    // with them — otherwise the seat-seeded zone filter would silently hide
    // a cross-zone search hit, which is exactly the case search exists for.
    if (!q) {
      if (zoneFilter) list = list.filter((c) => c.zoneName === zoneFilter);
      if (needsReplyOnly) {
        list = list.filter(
          (c) => !isHandled(c) && (c.unreadCount > 0 || c.lastDirection === "INBOUND"),
        );
      }
    }

    let scored = list.map((c) => ({ row: c, match: null }));
    if (q) {
      scored = list
        .map((c) => ({
          row: c,
          match: scoreMatch(q, {
            name: c.name,
            role: c.roleTitle,
            faction: c.factionName,
            username: [c.username, c.globalName].filter(Boolean).join(" "),
            zone: `${c.zoneName ?? ""} ${c.factionZoneName ?? ""}`.trim(),
            tag: c.tag,
            preview: c.preview,
          }),
        }))
        .filter((r) => r.match);
    }

    scored.sort((a, b) => {
      if (q) {
        if (b.match.score !== a.match.score) return b.match.score - a.match.score;
        const aHasThread = a.row.hasConversation;
        const bHasThread = b.row.hasConversation;
        if (aHasThread !== bHasThread) return aHasThread ? -1 : 1;
        return b.row.lastAtMs - a.row.lastAtMs;
      }
      const aPinned = isPinned(a.row);
      const bPinned = isPinned(b.row);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      const aUnread = a.row.unreadCount > 0;
      const bUnread = b.row.unreadCount > 0;
      if (aUnread !== bUnread) return aUnread ? -1 : 1;
      return b.row.lastAtMs - a.row.lastAtMs;
    });

    if (!q || !activeContentHits) return scored;

    // Content hits for people the fuzzy pass already found are redundant —
    // they are ranked by name/role/tag and stay where they are. What is worth
    // adding is everyone the fuzzy pass CANNOT see, because the only place
    // the query appears is inside the transcript.
    const alreadyShown = new Set(scored.map((entry) => entry.row.discordUserId));
    const eligible = new Map(list.map((r) => [r.discordUserId, r]));
    const extra = [];
    for (const hit of activeContentHits) {
      if (alreadyShown.has(hit.discordUserId)) continue;
      const row = eligible.get(hit.discordUserId);
      if (row) extra.push({ row, match: null, contentHits: hit.hits });
    }
    extra.sort((a, b) => b.row.lastAtMs - a.row.lastAtMs);
    return [...scored, ...extra];
  }, [
    inView,
    query,
    zoneFilter,
    needsReplyOnly,
    isPinned,
    activeContentHits,
    isHandled,
    isMuted,
    showMuted,
  ]);

  const mutedCount = useMemo(
    () => inView.filter((r) => r.hasConversation && isMuted(r)).length,
    [inView, isMuted],
  );

  // Mark-all-read only ever clears what this GM can actually see — otherwise
  // one click silently marks another zone's unread mail as handled.
  const unreadIds = useMemo(
    () => inView.filter((c) => c.unreadCount > 0).map((c) => c.discordUserId),
    [inView],
  );

  function markAllRead() {
    startTransition(async () => {
      // allSettled, not all: one closed thread rejecting must not take the
      // other ninety-nine marks — or the desk — down with it.
      await Promise.allSettled(
        unreadIds.map((id) => markConversationRead({ playerDiscordUserId: id })),
      );
    });
  }

  const searching = query.trim().length > 0;

  return (
    <DeskRail as="div" ariaLabel="Player inbox">
      {/* Two bands of chrome, then the inbox. It used to be up to five rows
          — search, a note, a zone row, a chip row, and a button per quiet
          verb, each on its own line — so on a laptop the first conversation
          started below the fold. */}
      <div className="desk-rail-filters">
        <div className="desk-rail-filter-line">
          <label className="field min-w-0" style={{ flex: "1 1 9rem" }}>
            <span className="field-label">Search inbox</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="name, role, faction, tag, zone, @handle, message text…"
            />
          </label>
          {zoneOptions.length > 0 && (
            <label className="field min-w-0" style={{ flex: "1 1 6rem" }}>
              <span className="field-label">Zone</span>
              <Select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
                <option value="">All</option>
                {zoneOptions.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>
        <div className="desk-rail-filter-line text-xs">
            {/* One independent toggle, so it is a chip, not a segmented
                control: a segmented control holds ONE VALUE out of several
                and this has no siblings to be exclusive with
                (DESIGN-SYSTEM §5). It shares the line with the quiet verbs
                rather than claiming a row. */}
            <button
              type="button"
              className="chip"
              data-active={needsReplyOnly ? "true" : undefined}
              aria-pressed={needsReplyOnly}
              onClick={() => setNeedsReplyOnly((v) => !v)}
            >
              Needs reply
            </button>
            {searching && <span className="text-muted">Searching everyone — filters paused.</span>}
            {unreadIds.length > 0 && (
              <button type="button" className="btn-quiet" onClick={markAllRead}>
                Mark all read
              </button>
            )}
            {mutedCount > 0 && (
              <button type="button" className="btn-quiet" onClick={() => setShowMuted((v) => !v)}>
                {showMuted ? `Hide muted (${mutedCount})` : `Show muted (${mutedCount})`}
              </button>
            )}
        </div>
      </div>

      <div className="desk-queue">
        {visible.map(({ row, match, contentHits: hitCount }) => {
          const active = selected === row.discordUserId;
          const pinned = isPinned(row);
          const handled = isHandled(row);
          const muted = isMuted(row);
          const claimedByOther =
            row.claimedByDiscordUserId && row.claimedByDiscordUserId !== myDiscordUserId;
          return (
            <div
              key={row.discordUserId}
              className="desk-queue-row"
              data-active={active ? "true" : "false"}
              data-muted={muted ? "true" : undefined}
              data-unread={row.unreadCount > 0 ? "true" : undefined}
              data-awaiting={
                row.lastDirection === "INBOUND" && row.unreadCount === 0 && !handled
                  ? "true"
                  : undefined
              }
            >
              <div className="desk-queue-marks">
                <button
                  type="button"
                  className="desk-queue-pin"
                  aria-pressed={pinned}
                  aria-label={pinned ? `Unpin ${row.name}` : `Pin ${row.name}`}
                  onClick={() => togglePin(row)}
                >
                  {pinned ? "★" : "☆"}
                </button>
                <button
                  type="button"
                  className="desk-queue-done"
                  aria-pressed={handled}
                  aria-label={
                    handled
                      ? `Mark ${row.name} as needing a reply`
                      : `Mark ${row.name} as needing no reply`
                  }
                  title={handled ? "Needs a reply after all" : "Needs no reply"}
                  onClick={() => toggleHandled(row)}
                >
                  ✓
                </button>
                <button
                  type="button"
                  className="desk-queue-mute"
                  aria-pressed={muted}
                  aria-label={muted ? `Unmute ${row.name}` : `Mute ${row.name}`}
                  title={muted ? "Unmute — back in the inbox" : "Mute — out of the inbox"}
                  onClick={() => toggleMuted(row)}
                >
                  ⊘
                </button>
              </div>
              {/* A button, not a Link. Opening somebody is client state now
                  (selection.js) — the URL still changes, by pushState, but the
                  router is not asked to navigate. That is what lets a click
                  you have moved on from be abandoned instead of run to
                  completion with the next one queued behind it. */}
              <button
                type="button"
                className="desk-queue-link"
                onClick={() => selectConversation(row.discordUserId)}
              >
                <div className="desk-queue-top">
                  <CharacterAvatar
                    characterId={row.characterId}
                    name={row.name}
                    version={row.avatarVersion}
                    catatonic={row.catatonic}
                  />
                  <span className="desk-queue-name">{row.name}</span>
                  {row.username && <span className="text-xs text-muted">@{row.username}</span>}
                  {row.zoneName ? <ZoneChip zoneName={row.zoneName} /> : null}
                  {row.status && row.status !== "ALIVE" && (
                    <EnumPill map={CHARACTER_STATUS} value={row.status} />
                  )}
                  {row.claimedByDiscordUserId && (
                    <span
                      className="chip"
                      title={claimedByOther ? "Claimed by another GM" : "Claimed by you"}
                    >
                      {claimedByOther ? "Claimed" : "Claimed · you"}
                    </span>
                  )}
                  {row.lastAtMs > 0 && (
                    <span className="desk-queue-time mono">{relativeTime(row.lastAtMs, now)}</span>
                  )}
                  {/* Three weights, one ladder: unread is full-strength and
                      bold, awaiting is full-strength, read is muted
                      (globals.css). The word is still here for anyone who
                      cannot read weight as meaning, but it is text in the
                      row's own voice rather than a fifth pill. */}
                  {row.lastDirection === "INBOUND" && row.unreadCount === 0 && !handled && (
                    <span className="desk-queue-awaiting text-xs">awaiting</span>
                  )}
                </div>
                <div className="desk-queue-preview">
                  {row.preview || (
                    <span className="text-muted">{row.roleTitle || "No messages yet"}</span>
                  )}
                </div>
                {/* One form across the rail, the roster and the inspector's
                    lookup (MatchHint.js): a muted `· what matched` suffix,
                    the value where the row has one and the field's own word
                    where it does not. Nothing renders for a name hit, or when
                    the matched field is empty on this row — that used to
                    leave a padded blank line under the preview that looked
                    like a rendering fault. */}
                <div className="desk-queue-reason">
                  <MatchHint
                    match={match}
                    values={{
                      role: row.roleTitle,
                      faction: row.factionName,
                      zone: row.zoneName,
                      tag: matchedTagNames(row.tagNames, query),
                    }}
                  />
                  {hitCount > 0 && <span className="text-xs text-muted"> · {hitCount} in messages</span>}
                </div>
              </button>
              {row.unreadCount > 0 && (
                <span className="desk-queue-unread mono">{row.unreadCount}</span>
              )}
            </div>
          );
        })}
        {visible.length === 0 && <p className="text-sm text-muted p-4">Nobody matches.</p>}
      </div>
    </DeskRail>
  );
}

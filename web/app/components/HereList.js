"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import EmptyState from "@/app/components/EmptyState";
import IconButton from "@/app/components/IconButton";
import ActionButton from "@/app/components/ActionButton";
import FormError from "@/app/components/FormError";
import LookReadout from "@/app/components/LookReadout";
import { EyeIcon } from "@/app/components/icons";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import { ACTION_HELP, actionFor, reasonFor } from "@/app/components/actionRegistry";
import { lookAtRow } from "@/app/(app)/chat/actions";
import { loadPeopleHere } from "@/app/(app)/character/rosterActions";
import useVisiblePoll from "@/app/(app)/chat/useVisiblePoll";

// HERE: who is standing where you are, and what you can do to them. Drawn at
// the top of /chat's Place panel and the sheet's Actions panel — same rows,
// same menu. Rows come from db/lib/whosHere.js, the same function the
// Discord "Who's here?" answers with.
//
// A FACE AND AN EYE ARE EARNED: standing in a room is public, but what's over
// somebody's face is not, so a row shows a face and a look only once you've
// watched that person SPEAK this turn (db/lib/sightings.js) — and shows what
// you saw, not what's true now. Unseen, a named row keeps its own face; a
// hood gets the question-mark plate and no eye.
//
// The eye points at the LINE, not the person: `sightingSeq` is the last line
// you heard, and the server resolves the speaker off it (db/lib/examineRow.js)
// — the browser is never told who is under a hood, so there is nothing to leak.
//
// The menu is the sheet's own people dialogs, opened through
// RequestActionsProvider with the person already filled in — nothing forked.
// A HOOD GETS A SHORTER MENU, NOT A DIFFERENT ONE (PROXYING.md §5). A hooded
// row carries no character id (shipping one is the unmasking) — it carries
// the hood token (db/lib/whosHere.js#hoodToken), resolved server-side.
//
// THE METAGAMING RULE STILL HOLDS (web/app/components/actionRegistry.js): no
// row is greyed for a fact about the person it names — that's the dialog's
// answer and the server's, never a menu hint.
//
// AND THESE ARE THE REGISTRY'S ROWS, so they take the registry's `show` and
// `gate` with them — the same two keys ActionGrid.js reads. This menu used to
// carry neither, which is how Perform Miracle came to sit on the menu of every
// player who wasn't a Saint. The two rules don't fight: every gate in the
// registry is a fact about YOUR OWN sheet by construction, so honouring them
// here hides nothing about who is standing near you.
//
// Look at is NOT on this menu (the eye on the row already is it). Move
// Player is gone entirely — the party rack below this list replaced it
// (docs/systemdocs/MAP.md §3a).
// Every row carries both prefixes now, and that is the whole rule: a hood hides
// WHO you are, never THAT you are standing there, so every verb on this menu
// reaches one. The preset it hands over is a TARGET KEY — "character:<id>" for
// somebody named, "hood:<token>" for somebody in a mask — which is the shape
// every pool in web/lib/peoplePools.js is keyed by and db/lib/targetKey.js
// resolves. A row with no hoodPrefix is dropped for hoods by the filter below,
// which is how Heal and Loot used to vanish for exactly the person bleeding out
// in front of you.
//
// Everything else about a row — whether it shows at all, whether it is greyed,
// and the sentence saying why — comes from the registry, not from here.
const HOOD_KEYS = { prefix: "character:", hoodPrefix: "hood:" };
const PEOPLE_ACTIONS = [
  { mode: "heal", label: "Heal", preset: "patientId", ...HOOD_KEYS },
  { mode: "miracle", label: "Perform Miracle", preset: "patientId", ...HOOD_KEYS },
  { mode: "transfer", label: "Transfer", preset: "toKey", ...HOOD_KEYS },
  { mode: "loot", label: "Loot", preset: "targetId", ...HOOD_KEYS },
  { mode: "bind", label: "Bind", preset: "targetId", ...HOOD_KEYS },
  { mode: "free", label: "Free", preset: "targetId", ...HOOD_KEYS },
  { mode: "harm", label: "Harm", preset: "targetId", ...HOOD_KEYS },
  // Kiss keeps its row for a hood even though kissBlock() will refuse a covered
  // face: the refusal is the gate, and the menu is not the place to re-implement
  // it (web/lib/peoplePools.js says the same about kissTargets).
  { mode: "kiss", label: "Kiss", preset: "targetId", ...HOOD_KEYS },
  { mode: "search", label: "Search", preset: "targetId", ...HOOD_KEYS },
];

// `person` is normalised by the two lists below to { ref, name, hooded }:
// a character id for somebody named, a hood token for somebody in one.
function PersonMenu({ person, onClose, onConverse, addPlace, onAddMember }) {
  const actions = useRequestActions();
  const open = actions?.open ?? null;
  const pools = actions?.pools ?? null;

  const pick = useCallback(
    (entry) => {
      onClose();
      if (!open) return;
      const prefix = person.hooded ? entry.hoodPrefix : entry.prefix;
      open(entry.mode, null, { [entry.preset]: prefix ? `${prefix}${person.ref}` : person.ref });
    },
    [open, onClose, person],
  );

  // A hood with no token is a hood nothing can act ON (hoodToken mints none without an AUTH_SECRET); Converse still works.
  // Then the registry's own `show`, exactly as ActionGrid.js applies it. A mode
  // the registry doesn't know stays on the menu, so nothing can vanish by
  // accident — the filter only ever removes a row somebody wrote a rule for.
  const entries = PEOPLE_ACTIONS.filter((entry) => {
    if (person.hooded && !(entry.hoodPrefix && person.ref)) return false;
    const action = actionFor(entry.mode);
    return action?.show ? Boolean(pools?.[action.show]) : true;
  });

  return (
    <div className="chat-menu" role="menu" aria-label={person.name}>
      {entries.map((entry) => {
        // The label stays the menu's own — these are spelled-out verbs, not the
        // rack's glyph captions. Everything else is the registry's.
        const action = actionFor(entry.mode);
        return (
          <ActionButton
            key={entry.mode}
            variant="menu"
            label={entry.label}
            help={ACTION_HELP[entry.mode] ?? null}
            disabled={action?.gate ? !pools?.[action.gate] : false}
            reason={action ? reasonFor(action, pools) : null}
            onClick={() => pick(entry)}
          />
        );
      })}
      {/* Only offered where there is a door to open; the server re-checks that this character may work it. */}
      {addPlace && onAddMember && person.ref && (
        <ActionButton
          variant="menu"
          label={`Add to ${addPlace.name}`}
          onClick={() => {
            onClose();
            onAddMember(person.ref);
          }}
        />
      )}
      {onConverse && (
        <ActionButton
          variant="menu"
          label="Converse"
          onClick={() => {
            onClose();
            // Opened ON this person, already ticked.
            onConverse({ ref: person.ref, name: person.name });
          }}
        />
      )}
    </div>
  );
}

const HERE_POLL_MS = 60_000;

export default function HereList({
  // The server's list, or null to read it on mount — the sheet passes null,
  // since opening it is the click that asks who is standing here.
  people,
  selfId,
  onConverse = null,
  poll = false,
  // The open place, when somebody can be let into it: { placeKey, name }.
  // Null everywhere else, which keeps the row off the menu.
  addPlace = null,
  onAddMember = null,
  // False when the caller already draws its own "Here · N" head — the
  // chat aside's `Here` block (chat.css `.block h3`) does, so this component
  // would otherwise say the count twice. The sheet's Actions panel has no
  // heading of its own and keeps the default.
  showTitle = true,
}) {
  // Seeded from the server, replaced by the poll. ChatAside keys this
  // component on the server list, so a move remounts it instead of leaving a stale poll answer.
  const [live, setLive] = useState(people);
  const named = live?.named ?? [];
  const concealed = live?.concealed ?? [];
  const [openId, setOpenId] = useState(null);

  const pollPeople = useCallback(() => {
    loadPeopleHere()
      .then((res) => {
        if (res?.ok) setLive({ named: res.named, concealed: res.concealed });
      })
      .catch(() => {
        // A missed read costs one stale minute; the next one fixes it.
      });
  }, []);
  // No seed means nobody has asked yet; ask now, then on the minute, only while the tab is visible.
  useEffect(() => {
    if (poll && people == null) pollPeople();
  }, [poll, people, pollPeople]);
  useVisiblePoll(pollPeople, HERE_POLL_MS, { enabled: poll });
  const [hood, setHood] = useState(null);
  // "Add to …" refused, or never reached the server — shown under the list the row was on.
  const [addError, setAddError] = useState(null);
  const addAndReport = useCallback(
    (ref) => {
      if (!onAddMember) return;
      setAddError(null);
      Promise.resolve(onAddMember(ref))
        .then((res) => {
          if (res && !res.ok) setAddError(res.error ?? "Something went wrong.");
        })
        .catch(() => setAddError("Could not reach the server. Nothing was changed."));
    },
    [onAddMember],
  );
  const actions = useRequestActions();
  // Kept on the wrapper rather than the document: a document listener would need an effect to attach.
  const wrapRef = useRef(null);

  const close = useCallback(() => setOpenId(null), []);

  // Fetch-then-set from a click, not an effect: the dialog is open the whole time the readout is in flight.
  const lookAtSeq = useCallback(
    (seq) => {
      close();
      setHood({ loading: true });
      lookAtRow(seq)
        .then((res) => {
          if (res?.ok) setHood({ readout: res.readout });
          else setHood({ error: res?.error ?? "You can't see them." });
        })
        .catch(() => setHood({ error: "You can't see them." }));
    },
    [close],
  );

  const total = named.length + concealed.length;

  return (
    <div
      className="chat-here"
      ref={wrapRef}
      onBlur={(event) => {
        if (!wrapRef.current?.contains(event.relatedTarget)) close();
      }}
    >
      {showTitle && <p className="group-label chat-section-title">Here · {total}</p>}
      {total === 0 && <EmptyState>Nobody is here.</EmptyState>}

      {named.map((person) => (
        <div key={person.characterId} className="chat-person-wrap">
          <div className="chat-person-row">
            <button
              type="button"
              className="chat-person"
              aria-haspopup="menu"
              aria-expanded={openId === person.characterId}
              onClick={() => setOpenId(openId === person.characterId ? null : person.characterId)}
            >
              {/* `avatarPath` is set only for a forced name's plaque or a face frozen at the last line you heard. */}
              <CharacterAvatar
                characterId={person.characterId}
                name={person.name}
                version={person.avatarVersion}
                src={person.avatarPath ?? undefined}
                size={24}
                online={person.online}
              />
              <span className="chat-person-name" data-role-group={person.roleGroup ?? undefined}>
                {person.name}
                {person.characterId === selfId ? <span className="text-muted"> · you</span> : null}
                {/* The avatar's glow ring is the mobile signal (portrait always
                    shows, name may not); this is desktop's second cue, beside it. */}
                {person.online ? <span className="text-muted"> · online</span> : null}
              </span>
            </button>
            {/* No eye until you have heard them. Absent rather than greyed — one rule instead of two. */}
            {person.characterId !== selfId && person.sightingSeq && (
              <span className="chat-person-eye">
                <IconButton icon={EyeIcon} label="Look at" onClick={() => lookAtSeq(person.sightingSeq)} />
              </span>
            )}
          </div>
          {openId === person.characterId && (
            <PersonMenu
              person={{ ref: person.characterId, name: person.name, hooded: false }}
              onClose={close}
              onConverse={onConverse}
              addPlace={addPlace}
              onAddMember={onAddMember ? addAndReport : null}
            />
          )}
        </div>
      ))}

      {/* Keyed by POSITION, not token: with no AUTH_SECRET, db/lib/whosHere.js mints none, and two hoods would share `hooded-null`. */}
      {concealed.map((person, index) => (
        <div key={`hooded-${index}`} className="chat-person-wrap">
          <div className="chat-person-row">
            <button
              type="button"
              className="chat-person"
              aria-haspopup="menu"
              aria-expanded={openId === `hooded-${index}`}
              onClick={() => setOpenId(openId === `hooded-${index}` ? null : `hooded-${index}`)}
            >
              {/* The mask, only if you watched them wear it — else the question-mark plate (PROXYING.md §5). */}
              <CharacterAvatar
                characterId={null}
                name={person.alias}
                src={person.avatarPath ?? undefined}
                unknown={person.unknownFace}
                size={24}
              />
              <span className="chat-person-name text-muted">{person.alias}</span>
            </button>
            {person.sightingSeq && (
              <span className="chat-person-eye">
                <IconButton icon={EyeIcon} label="Look at" onClick={() => lookAtSeq(person.sightingSeq)} />
              </span>
            )}
          </div>
          {/* The same menu the named rows get, filtered to what you can do to somebody you cannot name. */}
          {openId === `hooded-${index}` && (
            <PersonMenu
              person={{ ref: person.token ?? null, name: person.alias, hooded: true }}
              onClose={close}
              onConverse={onConverse}
              addPlace={addPlace}
              onAddMember={onAddMember ? addAndReport : null}
            />
          )}
        </div>
      ))}

      {/* Across a modular gate: seen through the bars, so listed, but nothing can be done to them — no menu, no eye. */}
      {(people?.across ?? []).map((group) => (
        <div key={group.locationId}>
          <p className="group-label chat-section-title">
            {group.locationName} · {group.named.length + group.concealed.length}
          </p>
          {group.named.map((person) => (
            <div key={person.characterId} className="chat-person-row">
              <span className="chat-person">
                <CharacterAvatar
                  characterId={person.characterId}
                  name={person.name}
                  version={person.avatarVersion}
                  src={person.avatarPath ?? undefined}
                  size={24}
                />
                <span className="chat-person-name" data-role-group={person.roleGroup ?? undefined}>
                  {person.name}
                </span>
              </span>
            </div>
          ))}
          {group.concealed.map((person, index) => (
            <div key={`across-hooded-${index}`} className="chat-person-row">
              <span className="chat-person">
                <CharacterAvatar
                  characterId={null}
                  name={person.alias}
                  src={person.avatarPath ?? undefined}
                  unknown={person.unknownFace}
                  size={24}
                />
                <span className="chat-person-name text-muted">{person.alias}</span>
              </span>
            </div>
          ))}
        </div>
      ))}

      <FormError>{addError}</FormError>

      {hood && <LookReadout state={hood} onClose={() => setHood(null)} />}
    </div>
  );
}

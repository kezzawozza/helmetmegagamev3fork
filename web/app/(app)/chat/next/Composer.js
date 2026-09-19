"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import IconButton from "@/app/components/IconButton";
import Select from "@/app/components/Select";
import { MoreIcon, SendIcon } from "@/app/components/icons";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";

import CommandMenu from "../CommandMenu";
import CommandStrip from "../CommandStrip";
import MentionMenu, { mentionQueryAt, matchRoster } from "../MentionMenu";
import useComposerCommands from "../useComposerCommands";
import useComposerAutosize from "../useComposerAutosize";
import { addPending, applyRow, markPendingFailed, isOwnRow } from "../feedStore";
import { readDraft, writeDraft } from "../draftStore";

// THE COMPOSER: what voice you are in, your hands, the words, and the send.
//
// Rebuilt from the other half of ../Feed.js. The COMMAND MACHINE is not
// rebuilt — `useComposerCommands` owns which command is open, its arguments,
// the `/` list and what Enter does with all of it, and `commands.js` is a
// registry and a dispatch contract rather than UI (CHAT-REBUILD.md). Both are
// kept and driven.
//
// Speech is ALREADY a command, which is the load-bearing fact here: Say,
// Shout and OOC drive command mode rather than adding a second send path, so
// the length cap, the clearing and the hand-back-on-refusal stay written once.

// A 429 answers with the seconds left; the reply to it is the same call once
// they are up. Past this many, the line is marked unsent and the player is
// told rather than left watching a spinner.
const MAX_SLOWMODE_RETRIES = 3;

export default function Composer({
  place,
  self,
  gm = false,
  roster = [],
  rows = [],
  // Where a command hands off to the page: a travel pick, a converse dialog,
  // a look readout, the decree composer, and the refresh /conceal needs
  // because the name every future row wears is a server prop.
  ctx = {},
  // The paperwork menu — Write, Seal, send by bird. Empty means no ✉ at all.
  lettersMenu = [],
  openAction = null,
  onTyping = null,
}) {
  const placeKey = place?.placeKey ?? null;
  // How long this place makes everybody wait after their own last line. It is
  // a property of the PLACE, not of the page — a slow street and a quick room
  // are one prop apart.
  const slowmodeMs = (place?.slowmodeSeconds ?? 0) * 1000;
  const textareaRef = useRef(null);
  const retryTimers = useRef(new Set());
  const [draft, setDraft] = useState(() => readDraft(placeKey));
  const [error, setError] = useState(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [hold, setHold] = useState(0);
  const [mention, setMention] = useState(null);
  const coarse = useIsCoarsePointer();

  const cmd = useComposerCommands({
    placeKind: place?.kind,
    gm,
    draft,
    setDraft,
    textareaRef,
    ctx: useMemo(() => ({ ...ctx, placeKey }), [ctx, placeKey]),
    coarse,
    onTyping,
  });
  const { available, command, slash, cmdMatches, cmdLine, cmdPending, cmdError, exitCommand, pickCommand, runCurrent } = cmd;

  useComposerAutosize(textareaRef, draft, command);

  // The @ list: the people standing where you stand, nobody else.
  const mentionMatches = useMemo(
    () => (mention ? matchRoster(roster, mention.query) : []),
    [mention, roster],
  );

  const insertMention = useCallback(
    (person) => {
      setMention((current) => {
        if (!current) return null;
        const before = draft.slice(0, current.at);
        const after = draft.slice(current.at + 1 + current.query.length);
        const token = `{char:${person.id}${person.name ? `|${person.name}` : ""}} `;
        setDraft(`${before}${token}${after}`);
        const caret = before.length + token.length;
        // After the value lands, or setSelectionRange moves a caret in the old
        // string. Not an effect — this is the tail of a click.
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(caret, caret);
        });
        return null;
      });
    },
    [draft],
  );

  // Drafts survive walking out of a room and back in, for as long as the tab
  // lives. Written on every keystroke because the alternative is losing what
  // somebody typed to a misclick in the places column.
  useEffect(() => {
    writeDraft(placeKey, draft);
  }, [placeKey, draft]);

  // Which voices this place offers, off the same `where` gate the slash list
  // takes — so a place that cannot be shouted in never shows Shout, and the
  // server re-checks it anyway, since a server action is a public endpoint.
  const speechModes = useMemo(
    () =>
      [
        // "Say", not "Speak": the mockup's own word, and the shortest of the
        // three, so the picker is never wider than it has to be.
        { mode: "speak", label: "Say", command: null },
        { mode: "shout", label: "Shout", command: "shout" },
        { mode: "ooc", label: "OOC", command: "ooc" },
      ].filter((m) => !m.command || available.some((e) => e.name === m.command)),
    [available],
  );

  // DERIVED, never stored. Two copies of "which voice is this" could disagree,
  // and the one in `command` is the one that actually sends. Null while some
  // OTHER command is open (/move, /look), which leaves all three unpressed —
  // honest, since none of them is what the box would run.
  const speechMode = command
    ? (speechModes.find((m) => m.command === command.entry.name)?.mode ?? null)
    : "speak";

  const pickSpeechMode = useCallback(
    (mode) => {
      const picked = speechModes.find((m) => m.mode === mode);
      if (!picked) return;
      if (!picked.command) {
        exitCommand(draft);
        return;
      }
      const entry = available.find((e) => e.name === picked.command);
      if (entry) pickCommand(entry, draft);
    },
    [available, draft, exitCommand, pickCommand, speechModes],
  );

  // SLOWMODE. The later of two deadlines: what this place makes everybody wait
  // after their own last line, and a hold a 429 put on this tab.
  const ownDeadline = useMemo(() => {
    if (slowmodeMs <= 0) return 0;
    let best = 0;
    for (const row of rows) {
      if (!row.seq || !isOwnRow(row, self?.characterId, self?.speakerKey) || !row.sentAt) continue;
      const at = new Date(row.sentAt).getTime();
      if (at > best) best = at;
    }
    return best > 0 ? best + slowmodeMs : 0;
  }, [rows, slowmodeMs, self?.characterId, self?.speakerKey]);

  const deadline = Math.max(hold, ownDeadline);

  // One re-render a second while a countdown runs, and nothing else: the
  // number is read off the clock in the render below, which is the one place
  // in this file where reading the clock is the point.
  const [, tick] = useState(0);
  useEffect(() => {
    if (deadline <= Date.now()) return undefined;
    const timer = setInterval(() => {
      tick((n) => n + 1);
      if (Date.now() >= deadline) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const waitSeconds = deadline > 0 ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;

  // Named, so it can schedule itself.
  const send = useCallback(
    async function send(clientId, content, attempt = 0) {
      try {
        const res = await fetch("/api/feed/say", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ place: placeKey, content, clientId }),
        });
        const data = await res.json().catch(() => null);

        if (res.status === 429) {
          const wait = Math.max(1, Number(data?.retryAfter) || 1) * 1000;
          setHold(Date.now() + wait);
          if (attempt >= MAX_SLOWMODE_RETRIES) {
            setError(data?.error ?? "That didn't send.");
            markPendingFailed(placeKey, clientId);
            return;
          }
          // The row stays pending and the countdown explains the wait, so
          // there is nothing to say that the number is not already saying.
          setError(null);
          const timer = setTimeout(() => {
            retryTimers.current.delete(timer);
            void send(clientId, content, attempt + 1);
          }, wait + 250);
          retryTimers.current.add(timer);
          return;
        }

        if (!res.ok) {
          setError(data?.error ?? "That didn't send.");
          markPendingFailed(placeKey, clientId);
          return;
        }
        setError(null);
        if (data?.row) applyRow(placeKey, data.row);
      } catch {
        setError("That didn't send.");
        markPendingFailed(placeKey, clientId);
      }
    },
    [placeKey],
  );

  // A scheduled retry outlives a change of place on purpose — it is still
  // carrying words somebody typed, and the send it will make names the place
  // they typed them in. Only a closed tab drops it.
  useEffect(() => {
    const timers = retryTimers.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const submit = useCallback(() => {
    // A command in the box is run by the hook, which owns its arguments, its
    // cap and what to do when the server refuses.
    if (command) {
      void runCurrent();
      return;
    }
    const text = draft.trim();
    if (!text) return;
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // The line goes up OPTIMISTICALLY and the box clears: waiting for the
    // round trip before either is what makes a chat feel slow.
    addPending(placeKey, { clientId, content: text, name: self?.name ?? null, sentAt: new Date().toISOString() });
    setDraft("");
    void send(clientId, text);
  }, [command, runCurrent, draft, placeKey, self?.name, send]);

  // THE HOOK TAKES THE KEY FIRST. It owns the `/` list's arrows, Escape out of
  // a command, and Enter when a command is open — so this only ever sees the
  // keys it left alone.
  const onKeyDown = (e) => {
    if (cmd.onKeyDown?.(e)) return;
    if (e.key !== "Enter" || e.shiftKey) return;
    // A phone keyboard's Enter is a newline; there is a send button for that.
    if (coarse) return;
    e.preventDefault();
    submit();
  };

  // The hook gets the change first and says whether it CONSUMED it. It does
  // whenever a command is open, because then the box is that command's text
  // argument and the hook owns its value — calling setDraft as well would be
  // two writers on one string.
  //
  // The one thing still ours inside a command is the @ list, for /ooc and
  // /shout: both put a line in a room, and being named in one should ping you
  // exactly as it does from plain speech.
  const onChange = (event) => {
    const value = event.target.value;
    const caret = event.target.selectionStart ?? value.length;
    if (cmd.onDraftChange(value)) {
      const named = cmd.mentionsHere ? mentionQueryAt(value, caret) : null;
      setMention(named ? { ...named, active: 0 } : null);
      return;
    }
    setDraft(value);
    // A `/` list open means the box is naming a command, not a person.
    if (cmd.readSlash(value, caret)) {
      setMention(null);
      onTyping?.();
      return;
    }
    const named = mentionQueryAt(value, caret);
    setMention(named ? { ...named, active: 0 } : null);
    onTyping?.();
  };

  // What a place refuses, and why. A street is not speech and a vantage is
  // somewhere you are watching rather than standing.
  const refusal = useMemo(() => {
    if (!place) return "Nowhere is open.";
    if (place.vantage) return "You are watching this from somewhere else.";
    if (place.kind === "loc") return "Go into a room, the zone summary channel, or a conversation to speak.";
    return null;
  }, [place]);

  if (refusal) return <p className="chat-quiet-line">{refusal}</p>;

  const limit = cmd.textArg?.maxLength ?? null;
  const over = limit != null && draft.trim().length > limit;

  return (
    <div className="chat-composer">
      <div className="chat-say-col">
        <div className="chat-say-row">
          {speechModes.length > 1 && (
            <Select
              className="chat-mode-select"
              aria-label="How to talk"
              value={speechMode ?? "speak"}
              onChange={(e) => pickSpeechMode(e.target.value)}
            >
              {speechModes.map((m) => (
                <option key={m.mode} value={m.mode}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}

          {/* NEVER give this `overflow` — the / and @ menus are positioned
              against it and hang off the top. */}
          <div className="field chat-composer-box well" data-command={command ? "true" : undefined}>
            {/* A command typed by hand has no other label anywhere, so it gets
                the strip. A voice PICKED FROM THE DROPDOWN does not: the
                dropdown beside it already reads "Shout", and repeating the
                word cost a whole row of the scene — the composer grew 27px
                the moment you chose it, and the feed shrank by the same. */}
            {command && !speechMode && <CommandStrip entry={command.entry} onExit={exitCommand} />}

            <div className="chat-composer-row">
              {lettersMenu.length > 0 && (
                <span className="chat-composer-tools">
                  <span className="chat-tool-wrap">
                    <IconButton
                      icon={MoreIcon}
                      label="More"
                      aria-haspopup="menu"
                      aria-expanded={toolsOpen}
                      onClick={() => setToolsOpen((was) => !was)}
                    />
                    {toolsOpen && (
                      <div className="chat-menu" role="menu" aria-label="More">
                        {lettersMenu.map((entry) => (
                          <button
                            key={entry.mode}
                            type="button"
                            role="menuitem"
                            className="menu-item"
                            disabled={entry.disabled}
                            onClick={() => {
                              setToolsOpen(false);
                              openAction?.(entry.mode);
                            }}
                          >
                            {entry.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </span>
                </span>
              )}

              <textarea
                ref={textareaRef}
                className="say"
                rows={1}
                value={draft}
                onChange={onChange}
                onKeyDown={onKeyDown}
                aria-label="Say something"
              />

              <button
                type="button"
                className="chat-composer-send"
                aria-label={cmd.verb ?? "Send"}
                disabled={cmdPending || over || (!draft.trim() && !command)}
                onClick={submit}
              >
                <SendIcon width="15" height="15" />
              </button>
            </div>

            {slash && (
              <CommandMenu
                matches={cmdMatches}
                active={slash.active ?? 0}
                onPick={(entry) => pickCommand(entry, draft)}
                onHover={(i) => cmd.setSlash?.((prev) => (prev ? { ...prev, active: i } : prev))}
              />
            )}
            {mention && (
              <MentionMenu
                matches={mentionMatches}
                active={mention.active ?? 0}
                onPick={(person) => insertMention(person)}
                onHover={(i) => setMention((prev) => (prev ? { ...prev, active: i } : prev))}
              />
            )}
          </div>
        </div>

        {/* ONE TEXT ROW, ALWAYS. Everything it draws is conditional — a
            countdown, a counter, a refusal — so without a reserved height the
            composer GREW the moment one appeared and shoved the whole feed up.
            1lh, not a pixel count, so it follows the type scale. The row is
            RESERVED, not filled: nothing is written here to take up space. */}
        <div className="chat-composer-foot">
          {waitSeconds > 0 && <span className="chat-countdown mono">{waitSeconds} s</span>}
          {limit != null && draft.trim().length > 0 && (
            <span className="chat-composer-count mono" data-over={over ? "true" : undefined}>
              {draft.trim().length}/{limit}
            </span>
          )}
          {(error || cmdError) && <span className="chat-composer-error">{error ?? cmdError}</span>}
          {cmdLine && <span className="chat-cmd-line">{cmdLine}</span>}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useRef, useState } from "react";
import FormError from "@/app/components/FormError";
import IconButton from "@/app/components/IconButton";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import { SendIcon } from "@/app/components/icons";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
import CommandMenu from "./CommandMenu";
import CommandStrip from "./CommandStrip";
import CommandArgs from "./CommandArgs";
import useComposerCommands from "./useComposerCommands";
import useComposerAutosize from "./useComposerAutosize";
import { textArgOf } from "./commands";
import { gmSystemPost } from "./actions";

// Lifted out of ./Feed.js (CHAT-REBUILD.md) unchanged, so both composers
// mount the SAME one — a GM reading a place they cannot speak in gets the
// same command line either way.

// A GM in GM view posts a system line into whatever place they can see —
// the web twin of Discord's /gm command. Deliberately minimal on the SPEAKING
// side: no character picker, hood, autocorrect, reactions, slowmode or pending
// queue. The row comes back over the SSE hub like any other, so the composer
// just clears on success.
//
// The `/` line is NOT minimal, though, and used to be missing entirely: a GM
// reading a place they cannot speak in had a bare textarea, so there was no way
// to run anything at all from Chat. It is the same command line the player's
// composer runs (./useComposerCommands.js), minus the four entries that need a
// body standing somewhere (commands.js#commandsFor).
export default function GmSystemComposer({ placeKey, placeKind, placeName, hasCharacter, people, members, ctx }) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);
  const coarse = useIsCoarsePointer();
  const cmd = useComposerCommands({
    placeKind,
    gm: true,
    hasCharacter,
    draft,
    setDraft,
    textareaRef,
    ctx,
    coarse,
  });
  const { command, slash, cmdMatches, cmdLine, cmdPending, cmdError } = cmd;
  useComposerAutosize(textareaRef, draft, command);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await gmSystemPost({ placeKey, content: text });
      if (result?.ok) setDraft("");
      else setError(result?.error ?? "Couldn't send that.");
    } catch (err) {
      setError(err?.message ?? "Couldn't send that.");
    } finally {
      setPending(false);
    }
  }, [draft, placeKey, pending]);

  const textArg = command ? textArgOf(command.entry) : null;

  return (
    <div className="chat-composer">
      <div className="field chat-composer-box" data-command={command ? "true" : undefined}>
        {command && <CommandStrip entry={command.entry} onExit={cmd.exitCommand} />}
        <div className="chat-composer-row">
          <textarea
            ref={textareaRef}
            aria-label={placeName ? `Post as Bascinet in ${placeName}` : "Post as Bascinet"}
            rows={1}
            value={draft}
            placeholder={
              command
                ? (textArg?.placeholder ?? "Press Enter to run it")
                : placeName
                  ? `Post as Bascinet in ${placeName}…`
                  : "Post as Bascinet…"
            }
            onChange={(e) => {
              const value = e.target.value;
              const caret = e.target.selectionStart ?? value.length;
              if (cmd.onDraftChange(value)) return;
              setDraft(value);
              cmd.readSlash(value, caret);
            }}
            onKeyDown={(e) => {
              if (cmd.onKeyDown(e)) return;
              if (coarse || e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              void submit();
            }}
            disabled={pending}
          />
          {/* `icon`, not a child. IconButton renders `<Icon />` from the prop
              and ignores children, so passing <SendIcon /> between the tags
              left Icon undefined and threw "Element type is invalid" the
              moment a GM opened a place they cannot speak in. */}
          <IconButton
            icon={SendIcon}
            label={cmd.verb ?? "Send"}
            className="icon-btn chat-composer-send"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (command ? cmd.runCurrent() : void submit())}
            disabled={
              command
                ? cmdPending || (Boolean(textArg) && !draft.trim())
                : pending || !draft.trim()
            }
          />
        </div>
        {slash && (
          <CommandMenu
            matches={cmdMatches}
            active={slash.active}
            onPick={cmd.pickCommand}
            onHover={(i) => cmd.setSlash((cur) => (cur ? { ...cur, active: i } : cur))}
          />
        )}
        {command && (
          <CommandArgs
            command={command}
            people={people}
            members={members ?? []}
            query={draft}
            onPick={cmd.setArg}
          />
        )}
      </div>
      {cmdLine && (
        <div className="chat-quiet-line">
          <ChatMarkdown content={cmdLine} />
        </div>
      )}
      <FormError>{error ?? cmdError}</FormError>
    </div>
  );
}

"use client";

import { useState } from "react";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import GmNoticeboardDialog from "./GmNoticeboardDialog";
import { gmSayHere } from "./actions";

// WHAT A GM DOES TO A PLACE, in the column where they are already reading it.
//
// Two things, and they are the two a GM has always had — just never here. The
// ambient line lived on /gm/dev behind a zone/location/room picker, which
// meant re-choosing the place you were already looking at every single time;
// the board lived on a bare button in the column this one replaces.
//
// One voice only, on purpose: scenery. Speaking ALOUD into a room as the bot
// is the /gm slash command's job and stays there for now — a full-size line
// archived as SYSTEM would light nobody's unread dot (feedStore.js#isNotableRow
// deliberately ignores SYSTEM rows so the scenery does not make places blink),
// and a loud line nobody is told about is worse than no button. That is its
// own change, with its own answer about what such a row should be.
//
// The cap is the server's; the box does not re-state it as a number, because
// the refusal says it in words and a character counter on a scenery line is
// noise.
export default function GmSayBox({ selected, onSaid }) {
  const [text, setText] = useState("");
  const [board, setBoard] = useState(false);
  const [notice, setNotice] = useState(null);
  const { run, pending, error } = useActionRunner();

  const placeKey = selected?.placeKey ?? null;
  // A conversation is somebody's private thread and a net is a frequency —
  // neither is a room scenery can happen in, which is the server's rule too.
  const sayable = selected?.kind === "loc" || selected?.kind === "room" || selected?.kind === "zone";

  function say() {
    if (!placeKey || !text.trim()) return;
    run(() => gmSayHere(placeKey, text), null, {
      onOk: (res) => {
        setText("");
        setNotice(res.line);
        onSaid?.(res);
      },
    });
  }

  return (
    <div className="chat-card">
      <p className="chat-section-title">Say something here</p>

      {sayable ? (
        <>
          <div className="field">
            <label htmlFor="gm-say">A line the world says</label>
            <textarea
              id="gm-say"
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={`Something happens in ${selected?.name ?? "here"}…`}
            />
          </div>
          <div className="chat-buttons">
            <button type="button" className="btn" disabled={pending || !text.trim()} onClick={say}>
              Say it
            </button>
          </div>
          {notice && <p className="chat-quiet-line">{notice}</p>}
          <FormError>{error}</FormError>
        </>
      ) : (
        <p className="chat-quiet-line">
          Scenery needs somewhere to happen. Open a Location, a room or a zone summary.
        </p>
      )}

      {/* The board, moved here from the bare column this replaces. The dialog
          is unchanged and already does all three — read every notice, seal
          included, tear one down, and put one up. */}
      {selected?.kind === "loc" && selected.hasBoard && (
        <div className="chat-buttons">
          <button type="button" className="btn-secondary" onClick={() => setBoard(true)}>
            Noticeboard
          </button>
        </div>
      )}
      {board && placeKey && <GmNoticeboardDialog placeKey={placeKey} onClose={() => setBoard(false)} />}
    </div>
  );
}

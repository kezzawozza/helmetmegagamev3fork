"use client";

// The three tabs of the Quests panel, and the one thing they share.
//
// Quests, Noticeboards and Broadcast sit together because they are one job in
// three parts: stage the thing, then tell people it is there. The Advertise
// button on a quest is that seam made real — it switches to Broadcast with the
// quest's own zone ticked and a line already written.
//
// That handoff is why the tabs are client state rather than `?s=quests&t=…`
// links: a link would reload the panel and drop the prefill on the floor.
import { useState } from "react";

import QuestsPanel from "./QuestsPanel";
import NoticeboardsPanel from "./NoticeboardsPanel";
import BroadcastPanel from "./BroadcastPanel";

const TABS = [
  { id: "quests", label: "Quests" },
  { id: "boards", label: "Noticeboards" },
  { id: "broadcast", label: "Broadcast" },
];

export default function QuestsSection({ quests, locations, tags, characters, boards, zones, canDelete }) {
  const [tab, setTab] = useState("quests");
  const [prefill, setPrefill] = useState(null);

  function advertise(quest) {
    setPrefill({
      zoneId: quest.zoneId,
      // A teaser, not the description: the point of an advert is to make
      // somebody walk there and read the real thing.
      text: `Word is going round about something at the ${quest.locationName}.`,
      // Bumped every time, so ticking Advertise twice re-applies the prefill
      // rather than being swallowed as an unchanged prop.
      at: Date.now(),
    });
    setTab("broadcast");
  }

  return (
    <>
      <div className="chat-tabstrip" role="tablist" aria-label="Quests">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="chat-tab"
            data-open={tab === t.id ? "true" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "quests" ? (
        <QuestsPanel
          quests={quests}
          locations={locations}
          tags={tags}
          characters={characters}
          canDelete={canDelete}
          onAdvertise={advertise}
        />
      ) : null}

      {tab === "boards" ? <NoticeboardsPanel boards={boards} /> : null}

      {/* Keyed on the prefill so a second Advertise re-applies it: the panel
          reads it as initial state, never syncs to it in an effect. */}
      {tab === "broadcast" ? (
        <BroadcastPanel key={prefill?.at ?? "blank"} zones={zones} prefill={prefill} />
      ) : null}
    </>
  );
}

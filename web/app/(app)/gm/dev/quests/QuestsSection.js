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
//
// The strip is .tab-bar / .tab-item, the house form for navigating between
// panels (DESIGN-SYSTEM.md §5). It used to borrow .chat-tabstrip from Chat's
// narrow aside, which is a different control on a surface a third the width.
// Keyed on data-active rather than aria-pressed: this is navigation, not a
// control holding a value.
import { useState } from "react";

import QuestsPanel from "./QuestsPanel";
import NoticeboardsPanel from "./NoticeboardsPanel";
import BroadcastPanel from "./BroadcastPanel";

export default function QuestsSection({ quests, locations, tags, characters, boards, zones, canDelete }) {
  const [tab, setTab] = useState("quests");
  const [prefill, setPrefill] = useState(null);

  // A count beside the label, as muted text rather than a chip: a chip names a
  // thing that simply is, and a number is neither that nor a state
  // (DESIGN-SYSTEM.md §5a).
  const tabs = [
    { id: "quests", label: "Quests", count: quests.length },
    { id: "boards", label: "Noticeboards", count: boards.length },
    { id: "broadcast", label: "Broadcast", count: null },
  ];

  function advertise(quest) {
    setPrefill({
      zoneId: quest.zoneId,
      // Carried so Broadcast can name the zone it could not tick. A cave has
      // no #summary channel, so a cave quest — which QUESTS.md says is the
      // usual kind — arrives here with a zone the picker does not offer.
      zoneName: quest.zoneName,
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
      <div className="tab-bar" role="tablist" aria-label="Quests">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="tab-item"
            data-active={tab === t.id ? "true" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count == null ? null : <span className="mono ml-1.5 text-muted">{t.count}</span>}
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

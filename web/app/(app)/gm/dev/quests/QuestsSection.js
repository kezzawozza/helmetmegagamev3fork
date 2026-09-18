"use client";

// The two tabs of the Quests panel.
//
// There used to be three: Quests, Noticeboards and a Broadcast tab, on the
// argument that they are one job in two parts — stage the thing, then tell
// people it is there. The telling half now lives with every other "say one
// thing to many" verb on the Dev Panel's bulk section, so the Advertise button
// on a quest is a plain link over there rather than a tab switch, carrying its
// zone and its teaser in the URL. That is strictly better than the client-state
// handoff it replaces, which dropped the prefill on any reload.
//
// The strip is .tab-bar / .tab-item, the house form for navigating between
// panels (DESIGN-SYSTEM.md §5). It used to borrow Chat's private tab strip's
// narrow aside, which is a different control on a surface a third the width.
// Keyed on data-active rather than aria-pressed: this is navigation, not a
// control holding a value.
import { useState } from "react";

import QuestsPanel from "./QuestsPanel";
import NoticeboardsPanel from "./NoticeboardsPanel";

export default function QuestsSection({ quests, locations, tags, characters, boards, canDelete }) {
  const [tab, setTab] = useState("quests");

  // A count beside the label, as muted text rather than a chip: a chip names a
  // thing that simply is, and a number is neither that nor a state
  // (DESIGN-SYSTEM.md §5a).
  const tabs = [
    { id: "quests", label: "Quests", count: quests.length },
    { id: "boards", label: "Noticeboards", count: boards.length },
  ];

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
        />
      ) : null}

      {tab === "boards" ? <NoticeboardsPanel boards={boards} /> : null}
    </>
  );
}

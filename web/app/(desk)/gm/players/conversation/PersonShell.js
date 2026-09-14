"use client";

import ConversationPane from "./ConversationPane";

// The person view: the conversation, and only the conversation. The shared
// inspector (components/InspectorColumn.js, via InspectorHost) covers the
// dossier; the Canon tab writes the draft through players/dmDraft.js. Keeps
// the layout class in sync with the route's loading.js.
export default function PersonShell(props) {
  return (
    <div className="desk-person">
      <ConversationPane {...props} />
    </div>
  );
}

// Rendered only as layout.js's `{children}`, which already draws `.chat-shell` — this must not redraw it. Aside is
// deliberately absent: Chat.js renders it only `{aside && …}`, and a GM with no living character has none.
export default function Loading() {
  return (
    <div className="chat-body" aria-hidden="true">
      <div className="chat-places" />
      <div className="chat-rail" />
      <div className="chat-centre">
        <div className="chat-main">
          <div className="chat-head" />
        </div>
      </div>
    </div>
  );
}

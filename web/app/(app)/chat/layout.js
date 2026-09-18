// Chat owns its whole screen, like the (desk) workspaces: no PageShell, no centred max-width, a column whose
// regions scroll inside it — a chat that scrolled the document would drag the universal top bar off the top on
// every message. No AppHeader any more; the bar (rendered by (app)/layout.js, above this shell) already says
// "Chat" via the active link, and hides itself here under 720px (chat.css) so the scene keeps the whole screen.
export default function PlayLayout({ children }) {
  return <div className="chat-shell">{children}</div>;
}

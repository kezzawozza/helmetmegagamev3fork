import AppHeader from "@/app/components/AppHeader";

// Chat owns its whole screen, like the (desk) workspaces: no PageShell, no centred max-width, a 100dvh column
// whose regions scroll inside it — a chat that scrolled the document would drag the header off the top on every message.
export default function PlayLayout({ children }) {
  return (
    <div className="chat-shell">
      <AppHeader title="Chat" />
      {children}
    </div>
  );
}

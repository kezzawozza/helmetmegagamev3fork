import Link from "next/link";
import { prisma } from "@lifeweb/db";
import AppHeader from "@/app/components/AppHeader";
import { loadHeaderIdentity } from "@/lib/headerIdentity";
import EscapeToChat from "./EscapeToChat";

// An ordinary page name, and nothing else — identity now lives in the band
// (LedgerBand.js). `loadHeaderIdentity()` (cache()d) still tells `backToChat`
// whether an ALIVE character exists, since Escape during creation means
// "close this", not "leave". Drawn from the layout because /character renders
// a client view and can't render AppHeader itself. No full-height shell —
// scrolls with the document like every route in this group (SHEET.md §1).
export default async function CharacterLayout({ children }) {
  const [character, config] = await Promise.all([
    loadHeaderIdentity(),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { playPanelEnabled: true } }),
  ]);
  // Left out when the Chat page is switched off (GameConfig.playPanelEnabled),
  // since /chat would only bounce back here.
  const backToChat = Boolean(character) && (config?.playPanelEnabled ?? true);
  return (
    <>
      <AppHeader
        title="Character"
        actions={
          backToChat ? (
            <Link href="/chat" className="btn-quiet">
              ← Back to the game · Esc
            </Link>
          ) : null
        }
      />
      {backToChat && <EscapeToChat />}
      {children}
    </>
  );
}

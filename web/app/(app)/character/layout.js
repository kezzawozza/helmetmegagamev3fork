import { prisma } from "@lifeweb/db";
import { loadHeaderIdentity } from "@/lib/headerIdentity";
import EscapeToChat from "./EscapeToChat";

// No header of its own any more — the universal top bar ((app)/layout.js)
// already says "Character" via the active link, and the "← Back to the game
// · Esc" link went with it. The Esc key handler stays: `loadHeaderIdentity()`
// (cache()d) still tells EscapeToChat whether an ALIVE character exists,
// since Escape during creation means "close this", not "leave". No
// full-height shell — scrolls with the document like every route in this
// group (SHEET.md §1).
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
      {backToChat && <EscapeToChat />}
      {children}
    </>
  );
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { dialogHoldsKeyboard } from "@/app/components/Modal";
import { hasModifier, isFieldFocused } from "@/lib/deskKeyGuard";

// Escape takes you back to the game. Mounted by /character's layout only
// when a living character exists (lobby/wizard keep their own Escape) and
// Chat isn't switched off. Precedence matches the desks' (gm/turns/Workspace.js):
// a keyboard-holding dialog keeps its Escape, a focused field just blurs, an
// open floating thing (pinned tag panel, menu, dropdown) closes itself first
// and the nav stands down — only a bare Escape navigates.
// CAPTURE phase deliberately: the menu/panel handlers sit on document and
// React flushes their close before a bubbling listener would run, so capture
// is what still sees the menu open.
const FLOATING = '.tag-tooltip[data-pinned], .chat-menu-portal, .select-popup';

export default function EscapeToChat() {
  const router = useRouter();

  useEffect(() => {
    // Warm the route so the navigation is a swap, not a fetch.
    router.prefetch("/chat");
    function onKey(e) {
      if (e.key !== "Escape" || hasModifier(e)) return;
      if (dialogHoldsKeyboard()) return;
      if (document.querySelector(FLOATING)) return;
      const active = document.activeElement;
      if (isFieldFocused(active)) {
        active.blur?.();
        return;
      }
      router.push("/chat");
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [router]);

  return null;
}

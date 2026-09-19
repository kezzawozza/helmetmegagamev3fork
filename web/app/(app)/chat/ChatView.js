"use client";

import { useSearchParams } from "next/navigation";

import EmptyState from "@/app/components/EmptyState";
import RequestActionsProvider from "@/app/components/RequestActionsProvider";
import CharacterMentionsProvider from "@/app/components/CharacterMentionsProvider";
import Chat from "./Chat";
import ChatNext from "./next/ChatNext";

// What /chat draws, from the one object page.js#FreshChat produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are the same names <Chat> and <RequestActionsProvider> always took;
// only the place they are spelled out moved.
export default function ChatView({ kind, chat, providers, roster, mentionDirectory = [] }) {
  // THE CUTOVER. The rebuilt chat is what /chat draws now
  // (docs/systemdocs/CHAT-REBUILD.md); `?old=1` still reaches the one it
  // replaced, for as long as that file is here to reach.
  const old = useSearchParams().get("old") === "1";
  if (kind === "empty" || kind === "nowhere") {
    return (
      <div className="chat-body chat-body--empty">
        <div className="panel">
          <EmptyState>{kind === "empty" ? "You have no living character." : "You are nowhere yet."}</EmptyState>
        </div>
      </div>
    );
  }
  const scene = old ? <Chat {...chat} /> : <ChatNext {...chat} />;
  if (!providers) return scene;
  return (
    <CharacterMentionsProvider characters={roster} directory={mentionDirectory}>
      <RequestActionsProvider {...providers}>{scene}</RequestActionsProvider>
    </CharacterMentionsProvider>
  );
}

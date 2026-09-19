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
  const next = useSearchParams().get("next") === "1";
  if (kind === "empty" || kind === "nowhere") {
    return (
      <div className="chat-body chat-body--empty">
        <div className="panel">
          <EmptyState>{kind === "empty" ? "You have no living character." : "You are nowhere yet."}</EmptyState>
        </div>
      </div>
    );
  }
  // THE CUTOVER IS THIS LINE. While the rebuild is in flight it is opt-in per
  // request (`/chat?next=1`) so the two can be compared side by side on the
  // same data; when it reaches parity this becomes `<ChatNext {...chat} />`
  // and ../Chat.js and its files are deleted in one commit.
  const scene = next ? <ChatNext {...chat} /> : <Chat {...chat} />;
  if (!providers) return scene;
  return (
    <CharacterMentionsProvider characters={roster} directory={mentionDirectory}>
      <RequestActionsProvider {...providers}>{scene}</RequestActionsProvider>
    </CharacterMentionsProvider>
  );
}

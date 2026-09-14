"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { CHAT_PLUGINS, DISCORD_COMPONENTS, escapeTokenBars } from "./markdownPlugins";
import MessageToken from "./messageTokens";

// One line of a scene, rendered. Adds over MarkdownContent.js: ||spoilers|| and quoted speech (remarkChat).
// Every plugin feeds ONE tree, which is why these are remark plugins rather than string passes — a mention inside
// a spoiler inside a quote has to still be a mention. Token vocabulary is messageTokens.js, shared with
// MarkdownContent, deliberately short so nobody can mint a live catalog chip mid-scene.

// Hidden until clicked, stays open after, like Discord's. A button rather than a span with onClick, for keyboard access.
function ChatSpoiler({ children }) {
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      className="chat-spoiler"
      data-shown={shown ? "true" : "false"}
      aria-label={shown ? undefined : "Hidden. Click to show it"}
      onClick={() => setShown(true)}
    >
      {children}
    </button>
  );
}

// The plugin list and ordering rule live in markdownPlugins.js, so this renderer and the DM one cannot drift apart.
const PLUGINS = CHAT_PLUGINS;
const COMPONENTS = { richtoken: MessageToken, chatspoiler: ChatSpoiler, ...DISCORD_COMPONENTS };

// memo'd on the text: a row is keyed by seq in feedStore.js, so a hundred rows re-parse nothing when the next lands.
function ChatMarkdown({ content }) {
  if (!content) return null;
  return (
    <div className="markdown-content chat-markdown">
      <ReactMarkdown remarkPlugins={PLUGINS} disallowedElements={["img"]} unwrapDisallowed components={COMPONENTS}>
        {escapeTokenBars(content)}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);

"use client";

import ReactMarkdown from "react-markdown";
import { MESSAGE_PLUGINS, DISCORD_COMPONENTS, escapeTokenBars } from "./markdownPlugins";
import MessageToken from "./messageTokens";

// Renders Discord-message markdown as real elements — used anywhere a DirectMessage's content is shown back to a
// GM, and in the player's own Bascinet pane. react-markdown never emits raw HTML from source text by default, so
// this is safe against injected markup; images are dropped since a message shouldn't embed one. Also renders
// Discord's angle-bracket vocabulary (remarkDiscord) and the {kind:payload} tokens (remarkTokens, messageTokens.js's
// short vocabulary shared with ChatMarkdown: a message may name a person, never mint a catalog chip). Deliberately
// does NOT get remarkChat — no speech tint, no spoilers; a DM is a GM and a player talking, not a scene.
const COMPONENTS = { richtoken: MessageToken, ...DISCORD_COMPONENTS };

export default function MarkdownContent({ content, className }) {
  if (!content) return null;

  return (
    <div className={`markdown-content ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={MESSAGE_PLUGINS}
        components={COMPONENTS}
        disallowedElements={["img"]}
        unwrapDisallowed
      >
        {escapeTokenBars(content)}
      </ReactMarkdown>
    </div>
  );
}

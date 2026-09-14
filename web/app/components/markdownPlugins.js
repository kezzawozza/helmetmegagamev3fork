import remarkGfm from "remark-gfm";
import remarkChat from "./remarkChat";
import remarkSubtext from "./remarkSubtext";
import remarkTokens from "./remarkTokens";
import remarkDiscord from "./remarkDiscord";
import DiscordTime from "./DiscordTime";
import { DiscordEmoji, DiscordMention, DiscordPing } from "./DiscordMarkupNodes";

// Every renderer must use one of these two lists. ORDER IS LOAD-BEARING:
// remarkSubtext (raw text) -> remarkTokens -> remarkDiscord -> remarkChat LAST.

// tokenEscape.js has no imports (loadable with no build step); keeps
// `{char:…}` intact and out of remark-gfm's table-bar split.
export { default as escapeTokenSyntax, default as escapeTokenBars } from "./tokenEscape";

// Prose read as words: DMs, the audit inspector, documents, the handbook.
export const MESSAGE_PLUGINS = [remarkGfm, remarkSubtext, remarkTokens, remarkDiscord];
// A scene line: MESSAGE_PLUGINS plus chat's own ||spoilers|| and speech tint.
export const CHAT_PLUGINS = [remarkGfm, remarkSubtext, remarkTokens, remarkDiscord, remarkChat];

// remarkDiscord's custom tags. Every renderer's `components` map must spread
// this in, or the tag renders as nothing.
export const DISCORD_COMPONENTS = {
  discordtime: DiscordTime,
  discordmention: DiscordMention,
  discordemoji: DiscordEmoji,
  discordping: DiscordPing,
};

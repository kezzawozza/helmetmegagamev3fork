import { findAndReplace } from "mdast-util-find-and-replace";
import { reFor } from "@lifeweb/db/lib/discordMarkup";

// Discord's angle-bracket vocabulary, turned into elements in the same mdast tree everything else renders from
// (node.data.hName/hProperties). Being in the one tree is the point: a <t:…> inside a quote stays inside it.
// Every pattern comes from db/lib/discordMarkup.js and none is spelled out here, so the guard in
// db/test/discordMarkup.test.js and this renderer can never drift apart about what a token looks like.

const text = (value) => ({ type: "text", value });

function node(hName, hProperties, children = []) {
  return { type: "discordNode", data: { hName, hProperties }, children };
}

// Sequential calls rather than one array of pairs, matching remarkChat.js. `ignore` matches remarkChat's too.
const IGNORE = { ignore: ["code", "inlineCode"] };

export default function remarkDiscord() {
  return (tree) => {
    // Properties are strings, what survives the trip through hast. `format`, not `style` — React owns `style`.
    findAndReplace(
      tree,
      [reFor("timestamp"), (_raw, epoch, style) => node("discordtime", { epoch, format: style ?? "" })],
      IGNORE,
    );

    // Roles before users: cannot overlap, but the order removes the question. See DiscordMarkupNodes.js.
    for (const kind of ["role", "user"]) {
      findAndReplace(tree, [reFor(kind), () => node("discordmention", {}, [text("someone")])], IGNORE);
    }
    findAndReplace(tree, [reFor("channel"), () => node("discordmention", {}, [text("somewhere")])], IGNORE);

    findAndReplace(
      tree,
      [reFor("emoji"), (_raw, _animated, name) => node("discordemoji", {}, [text(`:${name}:`)])],
      IGNORE,
    );

    findAndReplace(tree, [reFor("ping"), (raw) => node("discordping", {}, [text(raw)])], IGNORE);
  };
}

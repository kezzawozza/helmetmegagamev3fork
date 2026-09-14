import { findAndReplace } from "mdast-util-find-and-replace";
import { TOKEN_SOURCE } from "./richTokens";

// A remark plugin: turns each {kind:payload} token (see richTokens.js) into a <richtoken kind payload raw>
// element in the hast tree, via mdast-util-to-hast's hName/hProperties convention. DocumentMarkdown.js's
// `components` map then renders that as a live TagChip/ResourceChip, resolving correctly inside table cells,
// list items, etc. Payload holds no formatting (see tokenEscape.js). `ignore` matches remarkChat's/remarkDiscord's:
// inside code the text is meant to be literal, so `{tag:apex-form}` typed between backticks stays as typed.
export default function remarkTokens() {
  return (tree) => {
    findAndReplace(
      tree,
      [
        new RegExp(TOKEN_SOURCE, "g"),
        (raw, kind, payload) => ({
          type: "richToken",
          data: { hName: "richtoken", hProperties: { kind, payload, raw } },
        }),
      ],
      { ignore: ["code", "inlineCode"] },
    );
  };
}

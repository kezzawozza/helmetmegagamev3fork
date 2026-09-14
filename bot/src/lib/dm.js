const { prisma } = require("@lifeweb/db");
const { dmLogRow } = require("@lifeweb/db/lib/dmPolicy");

// Renders one embed to readable text: title, description, then each field as "**name**: value".
function embedText(e) {
  const data = e?.data ?? e ?? {};
  const lines = [data.title, data.description];
  for (const f of data.fields ?? []) {
    if (f?.name || f?.value) lines.push(`**${f.name}**: ${f.value}`);
  }
  return lines.filter(Boolean).join("\n");
}

function contentOf(payload) {
  if (typeof payload === "string") return payload;
  const parts = [];
  if (payload?.content) parts.push(payload.content);
  if (payload?.embeds?.length) parts.push(payload.embeds.map(embedText).filter(Boolean).join("\n\n"));
  return parts.join("\n");
}

// Every DM the bot sends is logged so the GM inbox has a full record with no per-call-site intercept.
async function sendDm(user, payload, opts = {}) {
  const dm = await user.createDM();
  const sent = await dm.send(payload);
  // db/lib/dmPolicy.js holds the kind/source defaults. Embeds/`meta` read off the payload, not
  // opts, so the reaction handlers that send one need no opts at all (an inspect readout is QUIET).
  const hasEmbeds = Boolean(payload?.embeds?.length);
  await prisma.directMessage
    .create({
      data: {
        ...dmLogRow({
          discordUserId: user.id,
          content: contentOf(payload), // no `»` here: callers write their own
          opts,
          discordMessageId: sent?.id ?? null,
          hasEmbeds,
        }),
        meta: opts.meta ?? (hasEmbeds ? { embed: true } : undefined),
      },
    })
    .catch(() => {});
  return { dm, sent };
}

module.exports = { sendDm };

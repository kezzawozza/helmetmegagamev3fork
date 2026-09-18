// Turns docs/systemdocs/infochannel.yaml into the text that lands in #info:
// the YAML load, `generated:` bodies, the directory message, finding the
// channel. No writes live here. Two scripts share it: sync-info-channel.js
// edits what's posted (the one to reach for); rebuild-info-channel.js throws
// the channel away and reposts. See docs/systemdocs/INFOCHANNEL.md.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { getGuildChannels, fetchAllMessages, bulkDeleteMessages } = require("./discordRest");
const { ROLE_GROUPS, ROLE_GROUP_OVERRIDES } = require("./roleGroups");
const { docsPath } = require("./repoPaths");

const YAML_PATH = docsPath("systemdocs", "infochannel.yaml");
const ROLES_YAML_PATH = docsPath("roles.yaml");
const DOCS_DIR = docsPath();

// Generator for the Fates thread. Name + intro text only, grouped by the
// seven social buckets of db/lib/roleGroups.js (imported, not duplicated, so
// the thread and the picker can't disagree). Names NO ZONE on purpose — that
// would tell readers where a faction camps before the game starts. A fate
// whose faction is whitelisted-only wears a ★ (`whitelist:`, not `leader:`).
// The bolded name is the high-cap go-anywhere fate. Reads roles.yaml fresh
// every run, so this thread can never drift from it.
const BOLD_ROLE_NAMES = new Set(["Migrant"]);

// "The Court" under a "Court" heading is just the heading again. Compared
// normalized so the faction line is skipped there and kept everywhere it
// carries something new ("The Sanctuary" under Saviors).
function sameName(a, b) {
  const strip = (v) => String(v ?? "").trim().toLowerCase().replace(/^the\s+/, "");
  return strip(a) === strip(b);
}

function buildRolesIntroBody() {
  const rolesDoc = yaml.load(fs.readFileSync(ROLES_YAML_PATH, "utf8"));

  const bucketOf = new Map();
  for (const group of ROLE_GROUPS) {
    for (const slug of group.factionSlugs) bucketOf.set(slug, group.slug);
  }
  const ELSEWHERE = "other";
  const order = [...ROLE_GROUPS, { slug: ELSEWHERE, name: "Elsewhere" }];
  // bucket slug -> ordered list of { factionName, lines }, one per faction
  const held = new Map(order.map((g) => [g.slug, []]));

  // `factions`/`roles` are slug-keyed MAPPINGS in roles.yaml, read the same way by syncRoles.js.
  for (const zone of rolesDoc.zones ?? []) {
    for (const [factionSlug, faction] of Object.entries(zone.factions ?? {})) {
      const home = bucketOf.get(factionSlug) ?? ELSEWHERE;
      for (const [roleSlug, role] of Object.entries(faction.roles ?? {})) {
        // Same precedence as groupRoles: a role may override its faction's bucket (Fisherman -> Soil).
        const wanted = ROLE_GROUP_OVERRIDES[roleSlug] ?? home;
        const bucket = held.has(wanted) ? wanted : ELSEWHERE;
        const marker = BOLD_ROLE_NAMES.has(role.name) ? "**" : "*";
        const whitelistMark = role.whitelist === true ? " (★)" : "";
        const line = `${marker}${role.name}${marker}${whitelistMark} — ${role.intro}`;

        const sections = held.get(bucket);
        let section = sections.find((s) => s.factionName === faction.name);
        if (!section) {
          section = { factionName: faction.name, lines: [] };
          sections.push(section);
        }
        section.lines.push(line);
      }
    }
  }

  // A heading is followed straight by its content; blank lines only separate groups.
  return order
    .filter((group) => held.get(group.slug).length > 0)
    .map((group) => {
      const sections = held.get(group.slug).map((section) =>
        sameName(section.factionName, group.name)
          ? section.lines.join("\n")
          : [`***${section.factionName}***`, ...section.lines].join("\n"),
      );
      return `# ${group.name}\n${sections.join("\n\n")}`;
    })
    .join("\n\n");
}

const GENERATORS = { "roles-intro": buildRolesIntroBody };

function loadInfoDoc() {
  return yaml.load(fs.readFileSync(YAML_PATH, "utf8"));
}

// Hand-authored `body` (if any) followed by generator output — lets a `generated` thread carry a
// static intro paragraph ahead of the auto-built content.
function resolveThreadBody(thread) {
  const parts = [];
  if (thread.body) parts.push(thread.body);
  if (thread.generated) parts.push(GENERATORS[thread.generated]());
  return parts.join("\n\n");
}

// Every thread the YAML names, flattened out of its categories, in order.
function infoThreads(doc) {
  return (doc.categories ?? []).flatMap((category) => category.threads ?? []);
}

async function findInfoChannel() {
  const channels = await getGuildChannels();
  const channel = channels.find((c) => c.type === 0 && c.name?.toLowerCase() === "info");
  if (!channel) throw new Error('No text channel named "info" found in this guild.');
  return channel;
}

const LINKS_LINE =
  "[Website](http://ravenheart.quest/) | [Handbook](http://ravenheart.quest/handbook)";

function buildDirectoryMessage(mainMessage, linksByCategory) {
  const sections = linksByCategory.map((category) => {
    const heading = category.name ? `**${category.name}**` : null;
    const lines = category.threadIds.map((id) => `<#${id}>`);
    const body = [category.intro, lines.join("\n")].filter(Boolean).join("\n");
    return [heading, body].filter(Boolean).join("\n");
  });
  return [mainMessage, ...sections, LINKS_LINE].join("\n\n");
}

// startThread's no-starter-message threads make Discord auto-post a "X
// started a thread: Y" system message (type 18) into the parent — swept up
// after everything else is posted so only real content remains.
const THREAD_CREATED_MESSAGE_TYPE = 18;

async function deleteThreadCreatedMessages(channelId) {
  const messages = await fetchAllMessages(channelId);
  const systemMessages = messages.filter((m) => m.type === THREAD_CREATED_MESSAGE_TYPE);
  if (systemMessages.length > 0) await bulkDeleteMessages(channelId, systemMessages.map((m) => m.id));
  console.log(`  cleaned up ${systemMessages.length} "started a thread" system message(s)`);
}

module.exports = {
  DOCS_DIR,
  loadInfoDoc,
  resolveThreadBody,
  infoThreads,
  findInfoChannel,
  buildDirectoryMessage,
  deleteThreadCreatedMessages,
};

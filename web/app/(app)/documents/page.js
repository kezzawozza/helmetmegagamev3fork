import { redirect } from "next/navigation";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import DocumentsView from "./DocumentsView";
import Loading from "./Skeleton";
import { auth } from "@/lib/auth";
import { DESIRE_UNLOCK_SELECT } from "@/lib/referenceData";
import { prisma, startingTagSlugs as parseStartingTagSlugs } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { toDocumentPreviewText } from "@/lib/documentPreview";
import { assignedTo, isWritten, readerFromCharacter } from "@/lib/documentAccess";
import { getHandbookBody, HANDBOOK_KEY } from "@/lib/handbook";
import { catalogTags } from "@/lib/tagCatalog";
import { redactWithheldRecipes } from "@/lib/recipeCatalog";
import { buildSkillAncestry, satisfiedSkillIds } from "@/lib/healRequests";
import { GRIMOIRE_DOCUMENT_KEY, expandGrimoire } from "@/lib/grimoire";
import { ensureRiteWords } from "@lifeweb/db/lib/riteWords";
import { APPRAISAL_SLUG } from "@lifeweb/db/lib/appraisal";
import { appraise } from "@/lib/appraisal";

export const metadata = { title: "Documents" };

// The matching rules live in web/lib/documentAccess.js so getDocumentIndex --
// which decides whether a {document:key} chip is a working link or an inert
// one -- cannot disagree with this page about who may read what. Matching
// still runs here on the server, so the client only ever receives documents
// that already apply.

// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshDocuments in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function DocumentsPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  return (
    <SnapshotPage scope="documents" userId={session.discordUserId} render={DocumentsView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshDocuments />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshDocuments() {
  // getGmSession() wraps auth() and is React-cached, so asking Discord whether
  // this user is a GM costs this page nothing it wasn't already paying.
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");

  const [rawDocuments, characterRow, tagRows] = await Promise.all([
    prisma.document.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.character.findFirst({
      where: { discordUserId: session.discordUserId, status: "ALIVE" },
      include: {
        role: true,
        faction: true,
        tags: { include: { tag: { select: { slug: true, name: true } } } },
      },
    }),
    // Per-character corpse rows are junk on a catalog page; the YAML monster
    // corpses (nekker-corpse, etc.) are on the secret list below anyway.
    prisma.tag.findMany({
      where: { corpseOfCharacterId: null },
      orderBy: { name: "asc" },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            color: true,
            slug: true,
            requiredTagId: true,
            // Drives TagChip's "Requires" line, same as TAG_CHIP_FIELDS.
            requiredTag: { select: { name: true } },
          },
        },
        requiredTag: { select: { name: true } },
        // `category` alongside the name: the Recipes tab reads it to tell the
        // trade that gates a recipe from a belief that also gates it
        // (web/lib/recipeCatalog.js#recipeDiscipline).
        requirementSkills: { select: { id: true, slug: true, name: true, category: true } },
        // The Tag Catalog tab's detail sheet, same block TagChip shows.
        ...DESIRE_UNLOCK_SELECT,
      },
    }),
  ]);

  const riteWordsCache = rawDocuments.some((d) => d.key === GRIMOIRE_DOCUMENT_KEY)
    ? await ensureRiteWords(prisma)
    : null;
  // The Grimoire is the one document whose text is generated: this game's
  // Words of the Circle, rolled on first read (web/lib/grimoire.js). Only
  // composed when the row exists, so a database without it rolls nothing.
  const documents = rawDocuments.some((d) => d.key === GRIMOIRE_DOCUMENT_KEY)
    ? rawDocuments.map((d) => expandGrimoire(d, riteWordsCache ?? {}))
    : rawDocuments;

  const character = readerFromCharacter(characterRow);
  const written = documents.filter(isWritten);

  const shape = (d, source) => ({
    key: d.key,
    name: d.name,
    description: d.description,
    previewText: toDocumentPreviewText(d.description),
    source,
  });

  // The player handbook, pinned first in Public — same synthesized-card shape
  // as the role charter below, reading from docs/handbook.md rather than a
  // Document row. Public rather than Assigned: it's the tab a character-less
  // visitor lands on, and the handbook is exactly what that visitor wants.
  // "handbook" is reserved in db/lib/syncDocuments.js#RESERVED_KEYS, so a real
  // Document can never collide with it.
  const handbookBody = getHandbookBody();
  const handbookCard = handbookBody
    ? {
      pinned: true,
      key: HANDBOOK_KEY,
      name: "Player Handbook",
      source: "Start here",
      description: handbookBody,
      previewText: toDocumentPreviewText(handbookBody),
    }
    : null;

  const publicDocs = [
    ...(handbookCard ? [handbookCard] : []),
    ...written.filter((d) => d.isPublic).map((d) => shape(d, "Public")),
  ];

  // GM-only papers. Unlike every other assignment, this one keys off a Discord
  // role rather than anything on a Character — a GM usually has no character at
  // all. Resolved here rather than in the client for the same reason the rest
  // of this file is: a player's browser must never receive the text.
  const gmDocs = isGm
    ? written.filter((d) => d.flags.includes("gamemaster")).map((d) => shape(d, "Gamemaster"))
    : [];

  // A Secret paper is the HOST's to read, not every GM's. This used to key on
  // "holds no zone seat", which meant the same thing back when only the master
  // was unseated — but a zone seat is now a zone VIEW that every GM sets for
  // themselves, and an unset one is the default. Left as it was, the first GM
  // to leave the control alone would have been handed every secret in the
  // game. It asks the question it always meant: are you the host.
  const isMasterGm = isGm && isSuperadmin(session.discordUserId);

  const secretDocs = isMasterGm
    ? written.filter((d) => d.isSecret).map((d) => shape(d, "Secret"))
    : [];

  // The All tab: every written document in the game, GM-only. Same gate as
  // gmDocs above — a Discord role, resolved server-side, so a player's browser
  // never receives the text. Its source line answers a different question from
  // every other tab's: not "why is this in your folder" (it isn't in anyone's
  // folder here) but "how does this paper reach a player at all".
  //
  // Secret papers are the one exception to "every document": they stay gated to
  // master GMs here exactly as they are in the Secret tab, so a zone-GM's All
  // never leaks a threat brief they can't open.
  //
  // A paper can also be handed out by a role's doc_elements list, which lives
  // on Role rather than on the document — so answering "unrouted" honestly
  // costs one extra query, run only for a GM.
  const docElementKeys = isGm
    ? new Set(
      (await prisma.role.findMany({ select: { docElements: true } }))
        .flatMap((r) => r.docElements),
    )
    : new Set();
  const allSource = (d) => {
    if (d.isPublic) return "Public";
    if (d.flags.includes("gamemaster")) return "Gamemaster";
    const routed =
      docElementKeys.has(d.key) ||
      d.tagSlugs.length > 0 ||
      d.roleSlugs.length > 0 ||
      d.factionSlugs.length > 0 ||
      d.flags.length > 0;
    return routed ? "Assigned" : "Unrouted";
  };
  const allDocs = isGm
    ? written.filter((d) => isMasterGm || !d.isSecret).map((d) => shape(d, allSource(d)))
    : [];

  const assignedDocs = character
    ? written
      .map((d) => [d, assignedTo(d, character)])
      .filter(([, source]) => source !== null)
      .map(([d, source]) => shape(d, source))
    : [];

  // The role charter, pinned first in Assigned.
  //
  // Role.description is a String[] of plain sentences (docs/roles.yaml), not
  // Markdown like a Document — joining them as a bullet list is the whole
  // conversion, and it is what lets this reuse the ordinary card and sheet
  // untouched.
  //
  // Role.intro is the creation wizard's one-sentence hook (character/page.js);
  // it opens the charter, italicised. No escaping guard, so an authored `_` or
  // `*` in an intro would break the wrapper — none has one today.
  //
  // `role: true` is already in the include above, so this costs no query.
  //
  // Not a Document row, so {document:…} can never resolve to it — the index
  // getDocumentIndex builds only ever lists real rows.
  const roleIntro = character?.role?.intro?.trim() ?? "";
  const roleBullets = character?.role?.description ?? [];
  // Intro OR bullets: some roles carry `description: []`, and a length-only
  // test would drop their charter off the page entirely.
  const roleCharter =
    roleIntro || roleBullets.length > 0
      ? {
        pinned: true,
        key: "role",
        name: character.role.name,
        source: "Your role",
        description: (roleIntro ? [`_${roleIntro}_\n`] : [])
          .concat(roleBullets.map((line) => `- ${line}`))
          .join("\n"),
        // Blank lines, not bullets: the card preview is flattened prose. Built
        // by hand rather than through toDocumentPreviewText, which flattens a
        // bullet list into one run-on string.
        previewText: (roleIntro ? [roleIntro] : []).concat(roleBullets).join("\n\n"),
      }
      : null;

  const assigned = roleCharter ? [roleCharter, ...assignedDocs] : assignedDocs;

  // Appraisal's readout (web/lib/appraisal.js). A fact about the reader's own
  // sheet, same as heldTagIds below.
  const canAppraise = (characterRow?.tags ?? []).some((ct) => ct.tag.slug === APPRAISAL_SLUG);

  // Tag Catalog tab: field shape mirrors /gm/dev/tags minus GM-only extras
  // (held counts, `custom`). Filtered server-side through catalogTags so a
  // withheld tag never reaches the browser — same posture as the document
  // tabs above.
  const mappedTags = tagRows.map((t) => appraise({
    id: t.id,
    name: t.name,
    slug: t.slug,
    category: t.category,
    description: t.description,
    pointCost: t.pointCost,
    groupId: t.groupId,
    groupName: t.group?.name ?? null,
    groupColor: t.group?.color ?? null,
    // Full group shape (not just the gate fields): TagChip reads
    // group.name/color for its chip and group.requiredTag.name for the
    // "Requires" line, alongside catalogTags' gate on requiredTagId.
    group: t.group
      ? {
        slug: t.group.slug,
        name: t.group.name,
        color: t.group.color,
        requiredTagId: t.group.requiredTagId,
        requiredTag: t.group.requiredTag,
      }
      : null,
    requiredTag: t.requiredTag,
    inspectVisibility: t.inspectVisibility,
    stackable: t.stackable,
    equippable: t.equippable,
    // The two lines this tab has never drawn, and the reason a player had to
    // pick a helmet up and try it on to find out where it went: TagChip's
    // "In a fight" (formatTagFighting) and "Worn" (describeEquipFit). This map
    // is the fourth hand-written copy of the chip's shape TAG_CHIP_FIELDS's own
    // comment warns about, and these four columns are what fell out of it.
    // All three equip columns or the Worn line lies — equipSlot alone reads a
    // two-hander as one-handed and drops the layer entirely.
    fighting: t.fighting,
    equipSlot: t.equipSlot,
    equipLayer: t.equipLayer,
    twoHanded: t.twoHanded,
    // TagChip's Armour line. Both halves, always: a chip showing only the
    // strong number hides that a breastplate is paper against a rifle.
    meleeArmor: t.meleeArmor,
    ballisticArmor: t.ballisticArmor,
    concealsIdentity: t.concealsIdentity,
    forcedName: t.forcedName,
    consumable: t.consumable,
    removable: t.removable,
    tradeable: t.tradeable,
    // With tradeable above, the "Weighs …" flag on the detail sheet and the
    // Weight row on every TagChip in this tab.
    weightLbs: t.weightLbs,
    craftable: t.craftable,
    customizable: t.customizable,
    healable: t.healable,
    teachable: t.teachable,
    purchasable: t.purchasable,
    purchasableAfterStart: t.purchasableAfterStart,
    mastery: t.mastery,
    catalogVisibility: t.catalogVisibility,
    depotPrice: t.depotPrice,
    defaultDurationTurns: t.defaultDurationTurns,
    sellable: t.sellable,
    sellablePrice: t.sellablePrice,
    parentTagId: t.parentTagId,
    requiredTagId: t.requiredTagId,
    consumesInto: t.consumesInto,
    expiresInto: t.expiresInto,
    removesInto: t.removesInto,
    // The medical pass's item-cure fields (TAGS.md §5c): what a consumable
    // cures, the per-item aftermath override, and who may administer it.
    cures: t.cures,
    curesInto: t.curesInto,
    administerable: t.administerable,
    administerSkill: t.administerSkill,
    requirementTurns: t.requirementTurns,
    requirementResources: t.requirementResources,
    requirementGambit: t.requirementGambit,
    requirementSkills: t.requirementSkills,
    // The rest of the recipe, for the Recipes tab. requirementItems is
    // redacted below before it reaches anybody — see recipeCatalog.js.
    requirementPerTurn: t.requirementPerTurn,
    requirementItems: t.requirementItems,
    // The building system's marker. The Recipes tab lists these like any other
    // recipe now; this still tells a reader the thing is raised on the ground
    // rather than carried away in a pocket.
    placement: t.placement,
    // Appraisal's readout (web/lib/appraisal.js) turns the raw sellablePrice
    // column above into valueObols for an appraiser, and strips it either
    // way — an over-broad select this tab has carried for a while must not
    // ship the number to a reader who hasn't earned it.
  }, canAppraise));

  const heldTagIds = (characterRow?.tags ?? []).map((ct) => ct.tagId);
  // Parsed, not raw: the column may carry a count ("obol x5") and catalogTags
  // matches on a bare slug.
  const startingTagSlugList = parseStartingTagSlugs(characterRow?.role?.startingTagSlugs ?? []);
  // Everything the reader's character counts as having for a recipe's skill
  // line: held tags plus the tiers they replace, the same ancestry walk the
  // Craft menu's own verdict runs (character/page.js#knownRecipeIds). Null
  // without a character, which is what hides the Recipes tab's checkbox.
  const mySkillIds = characterRow
    ? [...satisfiedSkillIds(heldTagIds, buildSkillAncestry(mappedTags))]
    : null;
  // Two passes, in this order. catalogTags decides which TAGS this reader may
  // see; redactWithheldRecipes then reads that answer back and drops the
  // recipe off any craftable naming an ingredient the first pass withheld. Both
  // tabs below take the same list, so a withheld ingredient can no more surface
  // in a Tag Catalog hover card than in the Recipes table.
  const tagCatalogList = redactWithheldRecipes(
    catalogTags(mappedTags, { isGm, heldTagIds, startingTagSlugs: startingTagSlugList }),
  );

  return (
    <SnapshotFresh
      scope="documents"
      userId={session.discordUserId}
      data={{
        publicDocs: publicDocs,
        assignedDocs: assigned,
        gmDocs: gmDocs,
        secretDocs: secretDocs,
        allDocs: allDocs,
        tagCatalog: tagCatalogList,
        hasCharacter: !!character,
        mySkillIds: mySkillIds,
      }}
    />
  );
}

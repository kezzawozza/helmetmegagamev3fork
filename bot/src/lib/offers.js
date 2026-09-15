// The Accept / Decline click on a consent DM (LESSONS.md). guild/member are
// null in a DM; the clicker is matched by Discord user id. The load, the
// ownership check and the order of the tail live in db/lib/dmAnswer.js
// (shared with the web's own twin, db/lib/dmActions.js) — this file keeps
// only what a gateway client can do and a REST one cannot: editing the
// interaction's own message, fetching a User to DM, and the room/carry syncs.
const { prisma } = require("@lifeweb/db");
const { answerDmAction } = require("@lifeweb/db/lib/dmAnswer");
const { DM_ACTION, DM_CHOICE } = require("@lifeweb/db/lib/dmActions");
const { deliverCarryDrop } = require("@lifeweb/db/lib/carry");
const { syncCharacterRoomAccess } = require("@lifeweb/db/lib/roomAccess");
const { sendDm } = require("./dm");
const { ack, respond } = require("./respond");
const {
  hideableFor,
  setHiddenItems,
  MENU_OPTION_LIMIT,
} = require("@lifeweb/db/lib/search");
const { SEARCH_HIDE_PICK_PREFIX } = require("@lifeweb/db/lib/offerRow");
const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");

async function settle(interaction, line) {
  const original = interaction.message?.content ?? "";
  await interaction
    .update({
      content: `${original}\n» ${line}`.slice(0, 2000),
      components: [],
    })
    .catch((err) => console.error("Offer button update failed:", err));
}

async function fanOut(interaction, dms) {
  for (const dm of dms ?? []) {
    const user = await interaction.client.users
      .fetch(dm.discordUserId)
      .catch(() => null);
    if (!user) continue;
    await sendDm(user, `» ${dm.content}`).catch((err) =>
      console.error(`Offer DM to ${dm.discordUserId} failed:`, err),
    );
  }
}

// The Discord half of what the router handed back. Best-effort: a failure
// here is the channel doctor's problem, not a reason to tell somebody the
// bind they accepted failed.
async function applySideEffects(interaction, sideEffects) {
  for (const characterId of sideEffects.roomSyncCharacterIds ?? []) {
    try {
      const row = await prisma.character.findUnique({ where: { id: characterId } });
      if (row) await syncCharacterRoomAccess(prisma, row);
    } catch (err) {
      console.error(`Post-bind room sync for ${characterId} failed:`, err);
    }
  }
  if (sideEffects.carryDrop) {
    await deliverCarryDrop(prisma, sideEffects.carryDrop).catch((err) =>
      console.error("Post-bind carry drop failed:", err),
    );
  }
  if (sideEffects.boundNotification) {
    await fanOut(interaction, [sideEffects.boundNotification]);
  }
}

async function handleOffer(interaction, offerId, choice) {
  const result = await answerDmAction(prisma, {
    action: { kind: DM_ACTION.OFFER, id: offerId },
    choice,
    discordUserId: interaction.user.id,
  });
  await settle(interaction, result.line);
  await fanOut(interaction, result.dms);
  await applySideEffects(interaction, result.sideEffects);
}

async function handleOfferAccept(interaction, offerId) {
  await handleOffer(interaction, offerId, DM_CHOICE.ACCEPT);
}

async function handleOfferDecline(interaction, offerId) {
  await handleOffer(interaction, offerId, DM_CHOICE.DECLINE);
}

// --- Search's third button (docs/systemdocs/SEARCH.md §2) -----------------
//
// TWO things here are easy to get wrong, and both are about WHICH message is
// being edited.
//
// 1. This must NOT call settle(). That strips the components off the DM, which
//    is how Accept and Decline finalise — but hiding is not an answer, so Yes
//    and No have to be sitting there afterwards. It replies ephemerally
//    instead, leaving the original alone.
// 2. handleSearchHidePick then updates the EPHEMERAL it opened, never the DM.
//
// Everything both faces must agree about is db/lib/search.js#setHiddenItems;
// what is left here is the picker's own chrome.
async function handleSearchHideOpen(interaction, offerId) {
  await ack(interaction);

  const loaded = await hideableFor(prisma, {
    offerId,
    discordUserId: interaction.user.id,
  });
  if (!loaded.ok) {
    await respond(interaction, loaded.reason);
    return;
  }
  if (loaded.rows.length === 0) {
    await respond(interaction, "You have nothing on you that could be hidden.");
    return;
  }

  // Heaviest first, so what the 25-cap cuts is the pocket litter rather than
  // the anvil. Discord caps a select menu at 25 options, and max_values must
  // track the SLICE or the whole component is rejected.
  const sorted = [...loaded.rows].sort((a, b) => (b.weightLbs ?? 0) - (a.weightLbs ?? 0));
  const shown = sorted.slice(0, MENU_OPTION_LIMIT);
  const already = new Set(loaded.hidden ?? []);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${SEARCH_HIDE_PICK_PREFIX}${offerId}`)
    .setPlaceholder("What to hide…")
    // Zero is a real answer: unticking everything is how you change your mind.
    .setMinValues(0)
    .setMaxValues(shown.length)
    .addOptions(
      shown.map((row) => ({
        label: row.quantity > 1 ? `${row.name} ×${row.quantity}` : row.name,
        value: row.tagId,
        // Opens on what is already hidden, so reopening the picker shows the
        // ticks rather than an empty menu that would silently clear them.
        default: already.has(row.tagId),
      })),
    );

  const truncated = sorted.length > shown.length;
  await respond(interaction, {
    content:
      "Pick what you want to hide. Hiding fewer things hides them better." +
      (truncated
        ? `\n-# Showing the ${shown.length} heaviest of ${sorted.length}. Use the website for the rest.`
        : ""),
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

async function handleSearchHidePick(interaction, offerId) {
  // deferUpdate, not ack: the thing being acknowledged is the EPHEMERAL this
  // select lives on, and the DM with Yes/No on it must be left alone.
  await interaction.deferUpdate();

  const saved = await setHiddenItems(prisma, {
    offerId,
    discordUserId: interaction.user.id,
    tagIds: interaction.values,
    // What this menu could actually show. Anything hidden BEYOND the 25-option
    // slice is carried through rather than replaced away — otherwise saving
    // here would quietly unhide what the player ticked on the web.
    scope: interaction.component?.options?.map((o) => o.value) ?? null,
  });
  const line = saved.ok
    ? saved.hidden.length === 0
      ? "Hiding nothing. Answer the search when you're ready."
      : `Hiding ${saved.hidden.length} thing${saved.hidden.length === 1 ? "" : "s"}. Answer the search when you're ready.`
    : saved.reason;

  await interaction
    .editReply({ content: `» *${line}*`, components: [] })
    .catch((err) => console.error("Search hide pick update failed:", err));
}

module.exports = {
  handleOfferAccept,
  handleOfferDecline,
  handleSearchHideOpen,
  handleSearchHidePick,
};

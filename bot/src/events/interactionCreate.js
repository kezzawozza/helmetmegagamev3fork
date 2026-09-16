const {
  MENU_OPTION_LIMIT,
  PICK_ID,
  BRING_ID,
  CONFIRM_PREFIX,
  EXERT_PREFIX,
  CANCEL_ID,
  loadMover,
  listNames,
  buildLocationSelectRow,
  buildBringRow,
  applyBring,
  freeZoneMovesReason,
  buildConfirmRow,
  freeMovesLeft,
  stowedMounts,
  performMove,
} = require("../lib/locationTravel");
const { heldReasonFor, INTERCEPT_RELEASE_PREFIX } = require("@lifeweb/db/lib/intercept");
const { ATTACK_CANCEL_PREFIX } = require("@lifeweb/db/lib/attack");
const { DM_ACTION, DM_CHOICE } = require("@lifeweb/db/lib/dmActions");
const {
  WHOS_HERE_PREFIX,
  SECRET_ROOMS_PREFIX,
  EXAMINE_PREFIX,
  CONVERSE_PREFIX,
  GATE_PREFIX,
  KEYED_PREFIX,
} = require("@lifeweb/db/lib/locationAnchorRow");
const {
  ROOM_STORAGE_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  ROOM_BELL_PREFIX,
  ROOM_PRAY_PREFIX,
  CENSOR_OFFICE_ROOM_SLUG,
} = require("@lifeweb/db/lib/roomStarterRow");
const { INTERCOM_MODAL_PREFIX, buildIntercomModal } = require("../lib/intercomModal");
const {
  QUEST_INTERACT_PREFIX,
  QUEST_MODAL_PREFIX,
  QUEST_INTENTION_FIELD,
  questInteract,
} = require("@lifeweb/db/lib/quests");
const {
  TURRET_MODAL_PREFIX,
  TURRET_WORD_FIELD,
  buildTurretModal,
  turretWordMatches,
} = require("../lib/turretModal");
const {
  BELL_MODAL_PREFIX,
  BELL_WORD_FIELD,
  buildBellModal,
  bellWordMatches,
} = require("../lib/bellModal");
const { LOBBY_DECLINE_PREFIX } = require("@lifeweb/db/lib/lobby");
const { handleLobbyDecline } = require("../lib/lobby");
const {
  buildConverseModal,
  CONVERSE_MODAL_PREFIX,
  CONVERSE_NAME_FIELD,
} = require("../lib/converseModal");
const { ack, respond, scheduleDismiss } = require("../lib/respond");
const { BIRD_REPLY_PREFIX, BIRD_REPLY_PICK_PREFIX } = require("@lifeweb/db/lib/bird");
const { handleBirdReplyOpen, handleBirdReplyPick } = require("../lib/birdReply");
const { NOTICEBOARD_PREFIX } = require("@lifeweb/db/lib/locationAnchorRow");
const {
  READ_PREFIX: NOTICE_READ_PREFIX,
  TEAR_PREFIX: NOTICE_TEAR_PREFIX,
  PIN_PREFIX: NOTICE_PIN_PREFIX,
  POST_PREFIX: NOTICE_POST_PREFIX,
  POST_MODAL_PREFIX: NOTICE_POST_MODAL_PREFIX,
  handleNoticeboardOpen,
  handleNoticeRead,
  handleNoticeTear,
  handleNoticePin,
  handleNoticePost,
  handleNoticePostSubmit,
} = require("../lib/noticeboardPanel");
const {
  OFFER_ACCEPT_PREFIX,
  OFFER_DECLINE_PREFIX,
  SEARCH_HIDE_PREFIX,
  SEARCH_HIDE_PICK_PREFIX,
} = require("@lifeweb/db/lib/offerRow");
const {
  handleOfferAccept,
  handleOfferDecline,
  handleSearchHideOpen,
  handleSearchHidePick,
} = require("../lib/offers");
const { PENDING_TAX_DECLINE_PREFIX, PENDING_TAX_PARTIAL_PREFIX } = require("@lifeweb/db/lib/tax");
const {
  TAX_PARTIAL_MODAL_PREFIX,
  handleTaxDecline,
  handleTaxPartialOpen,
  handleTaxPartialSubmit,
} = require("../lib/tax");
const {
  THREAT_SPAWN_ACCEPT_PREFIX,
  THREAT_SPAWN_DECLINE_PREFIX,
} = require("@lifeweb/db/lib/threats");
const { handleThreatSpawnAccept, handleThreatSpawnDecline } = require("../lib/threatSpawn");
const {
  OPEN_PREFIX: EDIT_OPEN_PREFIX,
  MODAL_PREFIX: EDIT_MODAL_PREFIX,
  handleEditOpen,
  handleEditSubmit,
} = require("../lib/editModal");
const { handleRoomStorage } = require("../lib/roomStorage");
const {
  ZONE_VIEW_ID,
  handleZoneCommand,
  handleZoneViewPick,
  handleGmCommand,
  handleGmDmCommand,
  handleThreadMemberCommand,
  handleRoomGuestCommand,
} = require("./interactions/admin");
const {
  PRAY_CONFIRM_PREFIX,
  handleIntercomOpen,
  handleQuestOpen,
  handleQuestSubmit,
  handleTurretOpen,
  handleBellOpen,
  handlePrayOpen,
  handlePrayConfirm,
  handleBellSubmit,
  handleTurretSubmit,
  handleIntercomSubmit,
} = require("./interactions/rooms");
const {
  handleTravelOpen,
  handleGateToggle,
  handleKeyedPrompt,
  handleHoldEnd,
  handleTravelPick,
  handleTravelBring,
  handleTravelConfirm,
  handleTravelCancel,
} = require("./interactions/travel");
const {
  CONVERSE_ROOM_PREFIX,
  handleWhosHere,
  handleExamine,
  handleSecretRooms,
  handleConverseOpen,
  handleConverseRoomPick,
  handleConverseCreate,
  handleConcealCommand,
} = require("./interactions/scene");
const {
  handleMoveOpen,
  handleMoveSubmit,
  handleSpeakOpen,
  handleSpeakSubmit,
  handleMessageCommand,
  handleHealCommand,
  handleHealPick,
  handleRollCommand,
  handlePlayCommand,
  handleShoutCommand,
  handleOocCommand,
} = require("./interactions/actions");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "gm") return void (await handleGmCommand(interaction));
        if (interaction.commandName === "zone") return void (await handleZoneCommand(interaction));
        if (interaction.commandName === "dm") return void (await handleGmDmCommand(interaction));
        if (interaction.commandName === "heal") return void (await handleHealCommand(interaction));
        if (interaction.commandName === "add" || interaction.commandName === "remove") {
          return void (await handleThreadMemberCommand(interaction, interaction.commandName));
        }
        if (interaction.commandName === "move") return void (await handleMoveOpen(interaction));
        if (interaction.commandName === "location" || interaction.commandName === "travel")
          return void (await handleTravelOpen(interaction));
        if (interaction.commandName === "conceal") return void (await handleConcealCommand(interaction));
        if (interaction.commandName === "message") return void (await handleMessageCommand(interaction));
        if (interaction.commandName === "roll") return void (await handleRollCommand(interaction));
        if (interaction.commandName === "play") return void (await handlePlayCommand(interaction));
        if (interaction.commandName === "shout") return void (await handleShoutCommand(interaction));
        if (interaction.commandName === "ooc") return void (await handleOocCommand(interaction));
      } else if (interaction.isButton()) {
        if (interaction.customId === "loc:open") return void (await handleTravelOpen(interaction));
        if (interaction.customId === CANCEL_ID) return void (await handleTravelCancel(interaction));
        if (interaction.customId.startsWith(CONFIRM_PREFIX)) {
          return void (await handleTravelConfirm(interaction, interaction.customId.slice(CONFIRM_PREFIX.length)));
        }
        if (interaction.customId.startsWith(EXERT_PREFIX)) {
          return void (await handleTravelConfirm(interaction, interaction.customId.slice(EXERT_PREFIX.length), { exert: true }));
        }
        if (interaction.customId.startsWith(WHOS_HERE_PREFIX)) {
          return void (await handleWhosHere(interaction, interaction.customId.slice(WHOS_HERE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(ROOM_STORAGE_PREFIX)) {
          return void (await handleRoomStorage(interaction, interaction.customId.slice(ROOM_STORAGE_PREFIX.length)));
        }
        // Opens a modal, so it must NOT be ack()'d first — see handleQuestOpen.
        if (interaction.customId.startsWith(QUEST_INTERACT_PREFIX)) {
          return void (await handleQuestOpen(interaction, interaction.customId.slice(QUEST_INTERACT_PREFIX.length)));
        }
        // Opens a modal, so it must NOT be ack()'d first — see handleIntercomOpen.
        if (interaction.customId.startsWith(ROOM_INTERCOM_PREFIX)) {
          return void (await handleIntercomOpen(interaction, interaction.customId.slice(ROOM_INTERCOM_PREFIX.length)));
        }
        if (interaction.customId.startsWith(ROOM_TURRET_PREFIX)) {
          return void (await handleTurretOpen(interaction, interaction.customId.slice(ROOM_TURRET_PREFIX.length)));
        }
        // The confirm first: "room:pray:go:<id>" also starts with the open
        // prefix, so testing the other way round would route every confirm
        // back into the dialog it came from.
        if (interaction.customId.startsWith(PRAY_CONFIRM_PREFIX)) {
          return void (await handlePrayConfirm(
            interaction,
            interaction.customId.slice(PRAY_CONFIRM_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(ROOM_PRAY_PREFIX)) {
          return void (await handlePrayOpen(interaction, interaction.customId.slice(ROOM_PRAY_PREFIX.length)));
        }
        if (interaction.customId.startsWith(ROOM_BELL_PREFIX)) {
          return void (await handleBellOpen(interaction, interaction.customId.slice(ROOM_BELL_PREFIX.length)));
        }
        if (interaction.customId.startsWith(SECRET_ROOMS_PREFIX)) {
          return void (await handleSecretRooms(interaction, interaction.customId.slice(SECRET_ROOMS_PREFIX.length)));
        }
        if (interaction.customId.startsWith(EXAMINE_PREFIX)) {
          return void (await handleExamine(interaction, interaction.customId.slice(EXAMINE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(CONVERSE_PREFIX)) {
          return void (await handleConverseOpen(interaction, interaction.customId.slice(CONVERSE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(GATE_PREFIX)) {
          return void (await handleGateToggle(interaction, interaction.customId.slice(GATE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(KEYED_PREFIX)) {
          return void (await handleKeyedPrompt(interaction, interaction.customId.slice(KEYED_PREFIX.length)));
        }
        if (interaction.customId.startsWith(INTERCEPT_RELEASE_PREFIX)) {
          return void (await handleHoldEnd(
            interaction,
            DM_ACTION.INTERCEPT_HOLD,
            interaction.customId.slice(INTERCEPT_RELEASE_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(ATTACK_CANCEL_PREFIX)) {
          return void (await handleHoldEnd(
            interaction,
            DM_ACTION.ATTACK_HOLD,
            interaction.customId.slice(ATTACK_CANCEL_PREFIX.length),
          ));
        }
        if (interaction.customId === "move:open") return void (await handleMoveOpen(interaction));
        if (interaction.customId === "say:open") return void (await handleSpeakOpen(interaction));
        // Arrive in a DM on a consent offer (docs/systemdocs/LESSONS.md), so
        // guild/member are null. Not acked: interaction.update() is the ack.
        if (interaction.customId.startsWith(OFFER_ACCEPT_PREFIX)) {
          return void (await handleOfferAccept(interaction, interaction.customId.slice(OFFER_ACCEPT_PREFIX.length)));
        }
        if (interaction.customId.startsWith(OFFER_DECLINE_PREFIX)) {
          return void (await handleOfferDecline(interaction, interaction.customId.slice(OFFER_DECLINE_PREFIX.length)));
        }
        // Search's third button (docs/systemdocs/SEARCH.md §2). Arrives in the
        // same DM as the two above, and unlike them it is NOT an answer — it
        // opens an ephemeral picker and deliberately leaves Yes/No on the
        // message, so this one IS acked (it does not call interaction.update).
        if (interaction.customId.startsWith(SEARCH_HIDE_PREFIX)) {
          return void (await handleSearchHideOpen(interaction, interaction.customId.slice(SEARCH_HIDE_PREFIX.length)));
        }
        // Arrives in a DM on a threat spawn offer (docs/systemdocs/THREATS.md),
        // so guild/member are null — and the clicker has no character yet,
        // which is the whole point. Not acked: interaction.update() is the ack.
        if (interaction.customId.startsWith(THREAT_SPAWN_ACCEPT_PREFIX)) {
          return void (await handleThreatSpawnAccept(
            interaction,
            interaction.customId.slice(THREAT_SPAWN_ACCEPT_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(THREAT_SPAWN_DECLINE_PREFIX)) {
          return void (await handleThreatSpawnDecline(
            interaction,
            interaction.customId.slice(THREAT_SPAWN_DECLINE_PREFIX.length),
          ));
        }
        // Arrives in a DM on a tax (docs/tags.yaml's `taxman` description), so
        // guild/member are null.
        if (interaction.customId.startsWith(PENDING_TAX_DECLINE_PREFIX)) {
          return void (await handleTaxDecline(
            interaction,
            interaction.customId.slice(PENDING_TAX_DECLINE_PREFIX.length),
          ));
        }
        // Opens a modal, so it must NOT be acked first.
        if (interaction.customId.startsWith(PENDING_TAX_PARTIAL_PREFIX)) {
          return void (await handleTaxPartialOpen(
            interaction,
            interaction.customId.slice(PENDING_TAX_PARTIAL_PREFIX.length),
          ));
        }
        // Arrives in a DM on an assignment (docs/systemdocs/LOBBY.md §4), so
        // guild/member are null and the clicker has no character yet.
        if (interaction.customId.startsWith(LOBBY_DECLINE_PREFIX)) {
          return void (await handleLobbyDecline(
            interaction,
            interaction.customId.slice(LOBBY_DECLINE_PREFIX.length),
          ));
        }
        // Arrives in a DM on a Bird's letter, so guild/member are null.
        if (interaction.customId.startsWith(BIRD_REPLY_PREFIX)) {
          return void (await handleBirdReplyOpen(interaction, interaction.customId.slice(BIRD_REPLY_PREFIX.length)));
        }
        // The board on a Location's anchor. Shown only where docs/zones.yaml
        // declared one (db/lib/noticeboard.js).
        if (interaction.customId.startsWith(NOTICEBOARD_PREFIX)) {
          return void (await handleNoticeboardOpen(interaction, interaction.customId.slice(NOTICEBOARD_PREFIX.length)));
        }
        // The GM's third row: a button where a player gets the Pin select,
        // because a GM holds no paper and writes the notice on the spot. It
        // opens a modal, so the handler must NOT be acked first.
        if (interaction.customId.startsWith(NOTICE_POST_PREFIX)) {
          return void (await handleNoticePost(interaction, interaction.customId.slice(NOTICE_POST_PREFIX.length)));
        }
        // Arrives in a DM; must NOT be acked first since it opens a modal.
        if (interaction.customId.startsWith(EDIT_OPEN_PREFIX)) return void (await handleEditOpen(interaction));
      } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === ZONE_VIEW_ID) return void (await handleZoneViewPick(interaction));
        if (interaction.customId === PICK_ID) return void (await handleTravelPick(interaction));
        if (interaction.customId === BRING_ID) {
          return void (await handleTravelBring(interaction));
        }
        // Must NOT be acked first: it opens a modal.
        if (interaction.customId.startsWith(CONVERSE_ROOM_PREFIX)) {
          return void (await handleConverseRoomPick(interaction));
        }
        if (interaction.customId.startsWith("heal:pick:")) {
          return void (await handleHealPick(interaction, interaction.customId.slice("heal:pick:".length)));
        }
        // The select inside the Hide-items ephemeral above. It updates that
        // ephemeral, never the consent DM.
        if (interaction.customId.startsWith(SEARCH_HIDE_PICK_PREFIX)) {
          return void (await handleSearchHidePick(
            interaction,
            interaction.customId.slice(SEARCH_HIDE_PICK_PREFIX.length),
          ));
        }
        // Answering a bird: which letter in your hands goes back.
        if (interaction.customId.startsWith(BIRD_REPLY_PICK_PREFIX)) {
          return void (await handleBirdReplyPick(interaction, interaction.customId.slice(BIRD_REPLY_PICK_PREFIX.length)));
        }
        // The three verbs on a noticeboard. Read is free to anyone standing
        // here; whether they can make anything of it is a separate question
        // the handler asks (db/lib/reading.js).
        if (interaction.customId.startsWith(NOTICE_READ_PREFIX)) {
          return void (await handleNoticeRead(interaction, interaction.customId.slice(NOTICE_READ_PREFIX.length)));
        }
        if (interaction.customId.startsWith(NOTICE_TEAR_PREFIX)) {
          return void (await handleNoticeTear(interaction, interaction.customId.slice(NOTICE_TEAR_PREFIX.length)));
        }
        if (interaction.customId.startsWith(NOTICE_PIN_PREFIX)) {
          return void (await handleNoticePin(interaction, interaction.customId.slice(NOTICE_PIN_PREFIX.length)));
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === "move:new") return void (await handleMoveSubmit(interaction));
        if (interaction.customId.startsWith(CONVERSE_MODAL_PREFIX)) {
          return void (await handleConverseCreate(interaction, interaction.customId.slice(CONVERSE_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith(NOTICE_POST_MODAL_PREFIX)) {
          return void (await handleNoticePostSubmit(
            interaction,
            interaction.customId.slice(NOTICE_POST_MODAL_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(QUEST_MODAL_PREFIX)) {
          return void (await handleQuestSubmit(interaction, interaction.customId.slice(QUEST_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith(INTERCOM_MODAL_PREFIX)) {
          return void (await handleIntercomSubmit(
            interaction,
            interaction.customId.slice(INTERCOM_MODAL_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(TURRET_MODAL_PREFIX)) {
          return void (await handleTurretSubmit(
            interaction,
            interaction.customId.slice(TURRET_MODAL_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(TAX_PARTIAL_MODAL_PREFIX)) {
          return void (await handleTaxPartialSubmit(
            interaction,
            interaction.customId.slice(TAX_PARTIAL_MODAL_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(BELL_MODAL_PREFIX)) {
          return void (await handleBellSubmit(interaction, interaction.customId.slice(BELL_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith("say:send:")) {
          return void (await handleSpeakSubmit(interaction, interaction.customId.slice("say:send:".length)));
        }
        if (interaction.customId.startsWith(EDIT_MODAL_PREFIX)) return void (await handleEditSubmit(interaction));
      }
    } catch (err) {
      console.error("interactionCreate handler failed:", err);
      await respondToFailure(interaction);
    }
  },
};

async function respondToFailure(interaction) {
  if (!interaction.isRepliable?.()) return;
  await respond(interaction, { content: "Something went wrong — that didn't go through.", components: [] });
}

const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

// The confirm on the two big red buttons: the Censor's Office and, since the
// Depot rework, the Merchant's Office (db/lib/placeAffordances.js). A modal,
// not a second button, since both of these kill people — the typed word is
// deliberate friction so a misclick can't shoot the Keep or the shop. The room
// id rides the customId so the submit handler can re-check where the presser is
// standing, at submit only.
//
// `prefix` is what tells the two apart at routing time; it defaults to the
// Gatehouse's, which is the one that was here first.
const { ARM_WORD, DISARM_WORD, turretWordMatches } = require("@lifeweb/db/lib/gatehouseTurret"); // shared with Chat's confirm

const TURRET_MODAL_PREFIX = "turret:toggle:";
const TURRET_WORD_FIELD = "turret:word";

function buildTurretModal(roomId, armed, prefix = TURRET_MODAL_PREFIX) {
  const word = armed ? DISARM_WORD : ARM_WORD;
  return new ModalBuilder()
    .setCustomId(`${prefix}${roomId}`)
    .setTitle(armed ? "Disarm the turret" : "Arm the turret")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(`Type ${word} to confirm`)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(TURRET_WORD_FIELD)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(16)
            .setRequired(true),
        ),
    );
}

module.exports = {
  TURRET_MODAL_PREFIX,
  TURRET_WORD_FIELD,
  ARM_WORD,
  DISARM_WORD,
  buildTurretModal,
  turretWordMatches,
};

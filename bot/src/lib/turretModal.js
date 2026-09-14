const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

// The confirm on the big red button in the Censor's Office
// (db/lib/roomStarterRow.js). A modal, not a second button, since this one
// kills people indiscriminately — the typed word is deliberate friction so a
// misclick can't shoot the Keep. The room id rides the customId so the
// submit handler can re-check where the presser is standing, at submit only.
const { ARM_WORD, DISARM_WORD, turretWordMatches } = require("@lifeweb/db/lib/gatehouseTurret"); // shared with Chat's confirm

const TURRET_MODAL_PREFIX = "turret:toggle:";
const TURRET_WORD_FIELD = "turret:word";

function buildTurretModal(roomId, armed) {
  const word = armed ? DISARM_WORD : ARM_WORD;
  return new ModalBuilder()
    .setCustomId(`${TURRET_MODAL_PREFIX}${roomId}`)
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

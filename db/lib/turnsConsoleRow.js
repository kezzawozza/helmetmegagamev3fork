// The #turns console buttons, as raw component JSON — plain JSON rather than discord.js builders because both faces need it and only one has discord.js. discord.js accepts raw component JSON exactly as the API does, so one definition serves both, avoiding the twin-drift ARCHITECTURE.md §3 warns about.
// The customIds are routed by exact equality in bot/src/events/interactionCreate.js — change one here and you must change it there.

const BUTTON = 2;
const ACTION_ROW = 1;
const SECONDARY = 2;

const MOVE_EMOJI = "⚜️";

const TURNS_CONSOLE_ROW = {
  type: ACTION_ROW,
  components: [
    { type: BUTTON, style: SECONDARY, custom_id: "move:open", label: "Move", emoji: { name: MOVE_EMOJI } },
    { type: BUTTON, style: SECONDARY, custom_id: "loc:open", label: "Travel", emoji: { name: "🗺️" } },
  ],
};

const CONSOLE_TEXT =
  "-# Moves take effect next turn • Crossing a zone is free once a turn, then it spends your Move • Use /message in a room to speak without showing you typing.";

module.exports = { TURNS_CONSOLE_ROW, CONSOLE_TEXT };

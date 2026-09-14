// Thin shim over @lifeweb/db/lib/moveConfirm.js — that module takes prisma as a parameter rather
// than requiring the barrel back.
const { prisma } = require("@lifeweb/db");
const { confirmMove: confirmMoveWith } = require("@lifeweb/db/lib/moveConfirm");

function confirmMove(action, actorDiscordUserId, options = {}) {
  return confirmMoveWith(prisma, action, actorDiscordUserId, options);
}

module.exports = { confirmMove };

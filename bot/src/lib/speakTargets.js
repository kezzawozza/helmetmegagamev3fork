const { PermissionFlagsBits } = require("discord.js");

// Derived from Discord's own permissions. A channel needs SendMessages; a thread needs
// SendMessagesInThreads — a different bit (db/lib/zoneChannelSpec.js#LOCATION_MEMBER_ALLOW).

function canSpeakInChannel(channel, member) {
  const perms = channel.permissionsFor(member);
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages);
}

function canSpeakInThread(thread, member) {
  const perms = thread.permissionsFor(member);
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessagesInThreads);
}

// The one predicate every caller uses — the modal's own check is only a courtesy.
function canSpeakInTarget(target, member) {
  if (!target || !member) return false;
  return target.isThread() ? canSpeakInThread(target, member) : canSpeakInChannel(target, member);
}

module.exports = { canSpeakInTarget };

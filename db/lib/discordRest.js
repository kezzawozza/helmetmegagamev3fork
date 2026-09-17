// Low-level Discord REST helpers shared by bot/ and web/ via @lifeweb/db —
// no gateway/discord.js dependency. Single-guild (DISCORD_GUILD_ID), same
// convention as web/lib/discordGuild.js.
//
// Barrel over db/lib/discordRest/*: core.js (fetch wrapper, breaker, rate
// limiting), then one module per Discord resource (channels, threads,
// messages, dms, roles, webhooks). Exports are listed explicitly, name by
// name, so a typo here fails loudly instead of silently shipping `undefined`.

const core = require("./discordRest/core");
const channels = require("./discordRest/channels");
const threads = require("./discordRest/threads");
const messages = require("./discordRest/messages");
const dms = require("./discordRest/dms");
const roles = require("./discordRest/roles");
const webhooks = require("./discordRest/webhooks");

module.exports = {
  discordRequest: core.discordRequest,
  getInvalidResponseStats: core.getInvalidResponseStats,
  breakerIsOpen: core.breakerIsOpen,
  attachBreakerStore: core.attachBreakerStore,
  loadBreakerState: core.loadBreakerState,
  recordInvalidResponse: core.recordInvalidResponse,
  beginRequestMetrics: core.beginRequestMetrics,
  readRequestMetrics: core.readRequestMetrics,

  getGuildChannels: channels.getGuildChannels,
  createDmChannel: dms.createDmChannel,
  forgetDmChannel: dms.forgetDmChannel,
  getChannel: channels.getChannel,
  deleteChannel: channels.deleteChannel,
  createChannel: channels.createChannel,
  patchGuildChannelPositions: channels.patchGuildChannelPositions,
  patchChannel: channels.patchChannel,
  postMessage: messages.postMessage,
  postMessageBatched: messages.postMessageBatched,
  postDmBatched: dms.postDmBatched,
  postAttachment: messages.postAttachment,
  chunkMessage: messages.chunkMessage,
  editMessage: messages.editMessage,
  createForumPost: threads.createForumPost,
  patchThread: threads.patchThread,
  THREAD_FLAG_PINNED: threads.THREAD_FLAG_PINNED,
  pinMessage: messages.pinMessage,
  deleteMessage: messages.deleteMessage,
  fetchAllMessages: messages.fetchAllMessages,
  bulkDeleteMessages: messages.bulkDeleteMessages,
  clearMessagesExcept: messages.clearMessagesExcept,
  snowflakeForTimestamp: messages.snowflakeForTimestamp,
  listActiveThreadsForChannel: threads.listActiveThreadsForChannel,
  fetchActiveThreads: threads.fetchActiveThreads,
  listArchivedPublicThreads: threads.listArchivedPublicThreads,
  listArchivedPrivateThreads: threads.listArchivedPrivateThreads,
  deleteThread: threads.deleteThread,
  getForumTagId: threads.getForumTagId,
  startThread: threads.startThread,
  startPrivateThread: threads.startPrivateThread,
  addThreadMember: threads.addThreadMember,
  removeThreadMember: threads.removeThreadMember,
  listThreadMembers: threads.listThreadMembers,
  getGuildRoles: roles.getGuildRoles,
  createGuildRole: roles.createGuildRole,
  patchGuildRole: roles.patchGuildRole,
  deleteGuildRole: roles.deleteGuildRole,
  addMemberRole: roles.addMemberRole,
  removeMemberRole: roles.removeMemberRole,
  getGuildMember: roles.getGuildMember,
  listGuildMembers: roles.listGuildMembers,
  messageTimestamp: messages.messageTimestamp,
  putChannelOverwrite: channels.putChannelOverwrite,
  deleteChannelOverwrite: channels.deleteChannelOverwrite,
  ensureChannelWebhook: webhooks.ensureChannelWebhook,
  executeWebhook: webhooks.executeWebhook,
  editWebhookMessage: webhooks.editWebhookMessage,
  deleteWebhookMessage: webhooks.deleteWebhookMessage,
  postAsCharacter: webhooks.postAsCharacter,
};

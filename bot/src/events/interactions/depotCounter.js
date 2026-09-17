// The Depot's counter, on Discord: the ATM on the Storefront, the drop box
// beside it, and the Merchant's gun on his office wall. Each is a button on a
// Room's starter post (db/lib/placeAffordances.js), and the rules behind all
// three live in db/lib/depotCounter.js so this face and the web's place panel
// answer the same way.
//
// Every one of these is deliberately thinner than its web twin. The Depot's
// page is where you compare prices and re-point a sale; these are for the
// moment you are standing at the machine with your phone out.
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  counterState,
  openCounterAccount,
  bankMove,
  dropIntoBox,
  depotTurretPanel,
  toggleDepotTurret,
} = require("@lifeweb/db/lib/depotCounter");
const { buildAmountModal } = require("../../lib/depotModals");
const { buildTurretModal, TURRET_WORD_FIELD } = require("../../lib/turretModal");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { postMessage } = require("@lifeweb/db/lib/discordRest");
const { ack, respond } = require("../../lib/respond");

const ATM_OUT_PREFIX = "depotatm:out";
const ATM_IN_PREFIX = "depotatm:in";
const ATM_OPEN_PREFIX = "depotatm:open";
const ATM_MODAL_PREFIX = "depotatm:m:";
const ATM_AMOUNT_FIELD = "depotatm:amount";

const DROP_PICK_PREFIX = "depotdrop:pick";
const DROP_MODAL_PREFIX = "depotdrop:m:";
const DROP_AMOUNT_FIELD = "depotdrop:amount";

const DEPOT_TURRET_MODAL_PREFIX = "depotturret:toggle:";

// Discord's select menus cap at 25 options, and a pocket with more than 25
// kinds of sellable thing in it is a job for the web page.
const DROP_OPTION_CAP = 25;

async function openTurn() {
  return prisma.turn.findFirst({ where: { closedAt: null }, orderBy: { number: "desc" } });
}

// ------------------------------------------------------------------- the ATM

async function handleAtmOpen(interaction) {
  await ack(interaction);
  const state = await counterState(prisma, interaction.user.id);
  if (!state.ok) {
    await respond(interaction, state.error);
    return;
  }

  if (!state.account) {
    await respond(interaction, {
      content: "» *Nothing here is yours yet. Opening an account costs nothing.*",
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(ATM_OPEN_PREFIX).setLabel("Create an account").setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return;
  }

  const backing = state.account.backed ? ` The Vault holds ${state.vaultObols} ¢.` : " Held off-world.";
  await respond(interaction, {
    content:
      `» *${state.account.fingerprint} — ${state.account.balanceObols} ¢ in the account, ` +
      `${state.heldObols} ¢ in your pocket.${backing}*`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ATM_OUT_PREFIX).setLabel("Take coin out").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ATM_IN_PREFIX).setLabel("Put coin in").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

async function handleAtmAccountOpen(interaction) {
  await ack(interaction);
  const turn = await openTurn();
  const result = await openCounterAccount(prisma, interaction.user.id, {
    turnNumber: turn?.number ?? null,
    turnId: turn?.id ?? null,
  });
  await respond(interaction, result.ok ? result.line : result.error);
}

// showModal IS the acknowledgement, so these must NOT be acked first.
async function handleAtmAmountOpen(interaction, withdrawing) {
  await interaction.showModal(
    buildAmountModal({
      customId: `${ATM_MODAL_PREFIX}${withdrawing ? "out" : "in"}`,
      field: ATM_AMOUNT_FIELD,
      title: withdrawing ? "Take coin out" : "Put coin in",
      label: "How many obols",
    }),
  );
}

async function handleAtmSubmit(interaction, which) {
  await ack(interaction);
  const turn = await openTurn();
  const result = await bankMove(prisma, interaction.user.id, {
    direction: which === "out" ? "WITHDRAW" : "DEPOSIT",
    amount: Number(interaction.fields.getTextInputValue(ATM_AMOUNT_FIELD)),
    turn,
  });
  await respond(interaction, result.ok ? result.line : result.error);
}

// -------------------------------------------------------------- the drop box

async function handleDropBoxOpen(interaction) {
  await ack(interaction);
  const state = await counterState(prisma, interaction.user.id);
  if (!state.ok) {
    await respond(interaction, state.error);
    return;
  }
  if (!state.account) {
    await respond(interaction, "You have no account here yet. The ATM opens one.");
    return;
  }
  if (!state.sellable.length) {
    await respond(interaction, "Nothing on you the station buys.");
    return;
  }

  const where =
    state.defaultDestination === "MERCHANT"
      ? "the Merchant's account"
      : state.defaultDestination === "TREASURY"
        ? "the Treasury"
        : "your account";
  const tax = state.sellTaxRate > 0 ? ` The Meister takes ${state.sellTaxRate}%.` : "";

  await respond(interaction, {
    content:
      `» *It pays into ${where} when the train next leaves.${tax} ` +
      `Pick a destination on the Depot page if you want a different one.*`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(DROP_PICK_PREFIX)
          .setPlaceholder("What goes in?")
          .addOptions(
            state.sellable.slice(0, DROP_OPTION_CAP).map((item) => ({
              label: item.name.slice(0, 100),
              description: `${item.unitPrice} ¢ each · ${item.quantity} held`.slice(0, 100),
              value: item.tagId,
            })),
          ),
      ),
    ],
  });
}

// Opens a modal, so it must NOT be acked first.
async function handleDropBoxPick(interaction) {
  const tagId = interaction.values?.[0] ?? "";
  await interaction.showModal(
    buildAmountModal({
      customId: `${DROP_MODAL_PREFIX}${tagId}`,
      field: DROP_AMOUNT_FIELD,
      title: "Into the box",
      label: "How many",
    }),
  );
}

async function handleDropBoxSubmit(interaction, tagId) {
  await ack(interaction);
  const turn = await openTurn();
  // The destination is re-derived server-side from the presser's own papers;
  // Discord never offers the choice, so there is nothing here to trust.
  const state = await counterState(prisma, interaction.user.id);
  if (!state.ok) {
    await respond(interaction, state.error);
    return;
  }
  const result = await dropIntoBox(prisma, interaction.user.id, {
    tagId,
    quantity: Number(interaction.fields.getTextInputValue(DROP_AMOUNT_FIELD)),
    destination: state.defaultDestination,
    turn,
  });
  await respond(interaction, result.ok ? result.line : result.error);
}

// ---------------------------------------------------------------- the gun

// Opening the modal isn't the act — the typed word is — so this only checks
// which way the switch is thrown. Everything else waits for the submit.
async function handleDepotTurretOpen(interaction) {
  const panel = await depotTurretPanel(prisma, interaction.user.id);
  if (!panel.ok) {
    await ack(interaction);
    await respond(interaction, panel.error);
    return;
  }
  await interaction.showModal(buildTurretModal("depot", panel.armed, DEPOT_TURRET_MODAL_PREFIX));
}

async function handleDepotTurretSubmit(interaction) {
  await ack(interaction);
  const turn = await openTurn();
  const result = await toggleDepotTurret(prisma, interaction.user.id, {
    word: interaction.fields.getTextInputValue(TURRET_WORD_FIELD),
    turn,
  });
  if (!result.ok) {
    await respond(interaction, result.error);
    return;
  }

  // The room's only warning; best-effort, the switch is thrown either way.
  const location = await prisma.location
    .findUnique({ where: { id: result.locationId }, select: { discordChannelId: true } })
    .catch(() => null);
  if (location?.discordChannelId) {
    await postMessage(location.discordChannelId, ambientLine(result.ambient, [], { signed: false })).catch((err) =>
      console.error("Depot turret line failed:", err),
    );
  }

  await respond(interaction, result.line);
}

module.exports = {
  ATM_OUT_PREFIX,
  ATM_IN_PREFIX,
  ATM_OPEN_PREFIX,
  ATM_MODAL_PREFIX,
  DROP_PICK_PREFIX,
  DROP_MODAL_PREFIX,
  DEPOT_TURRET_MODAL_PREFIX,
  handleAtmOpen,
  handleAtmAccountOpen,
  handleAtmAmountOpen,
  handleAtmSubmit,
  handleDropBoxOpen,
  handleDropBoxPick,
  handleDropBoxSubmit,
  handleDepotTurretOpen,
  handleDepotTurretSubmit,
};

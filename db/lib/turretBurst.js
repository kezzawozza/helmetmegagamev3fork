// The noise a turret makes. Separate from db/lib/turretPass.js because that file must never depend on Discord — being shot is a database fact, resolved above every DISCORD_TOKEN guard. This is the part that happens afterwards, and is allowed to fail.
// Two volumes: full-size in the Location the gun is standing in, `-#` subtext (db/lib/ambientLine.js) elsewhere in the zone. Fires on EVERY burst, grazes included, so the Gatehouse yard is visibly dangerous before you walk into it. Once per BURST, never once per victim (db/lib/turretPass.js#sweepTurretAt).
// Takes `prisma` as a parameter; see db/lib/dm.js for why.
const { ambientLine } = require("./ambientLine");
const { postMessage } = require("./discordRest");
const { sceneLineAt } = require("./scene");

const BURST_SOUND = "You hear a machinegun open up. RRATATAT!";
const BURST_TEXT = BURST_SOUND;

async function announceTurretBurst(prisma, locationId) {
  if (!locationId || !process.env.DISCORD_TOKEN) return { sent: 0 };

  const here = await prisma.location.findUnique({
    where: { id: locationId },
    select: { id: true, name: true, discordChannelId: true, zoneId: true },
  });
  if (!here) return { sent: 0 };

  let sent = 0;

  if (here.discordChannelId) {
    try {
      await postMessage(here.discordChannelId, BURST_TEXT);
      sent += 1;
    } catch (err) {
      console.error(`Turret burst in ${here.name} failed:`, err.message ?? err);
    }
  }
  await sceneLineAt(prisma, { locationId: here.id, text: BURST_SOUND });

  if (!here.zoneId) return { sent };

  // Sequential and individually caught. Never Promise.all a Discord fan-out (docs/systemdocs/TURN-ENGINE.md) — the burst of 429s is what earns an IP-level ban.
  const elsewhere = await prisma.location.findMany({
    where: { zoneId: here.zoneId, id: { not: here.id }, discordChannelId: { not: null } },
    select: { id: true, name: true, discordChannelId: true },
  });
  const heard = ambientLine(BURST_SOUND);
  for (const location of elsewhere) {
    try {
      await postMessage(location.discordChannelId, heard);
      sent += 1;
    } catch (err) {
      console.error(`Turret burst carrying to ${location.name} failed:`, err.message ?? err);
    }
    await sceneLineAt(prisma, { locationId: location.id, text: BURST_SOUND });
  }

  return { sent };
}

module.exports = { BURST_TEXT, announceTurretBurst };

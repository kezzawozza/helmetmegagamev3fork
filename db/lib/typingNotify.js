// The third NOTIFY channel of the live feed: "somebody is typing here." Carries just a place key and a character id — no name, since which name that character wears is a forced-name/concealment question, and the WRITER's side must not decide it. The web hub resolves the presented name for itself before fanning anything. Best-effort, like the other two.

const TYPING_CHANNEL = "bascinet_typing";

async function notifyTyping(prisma, { placeKey, characterId } = {}) {
  if (!placeKey || !characterId) return false;
  try {
    const payload = JSON.stringify({ placeKey, characterId });
    await prisma.$executeRaw`SELECT pg_notify(${TYPING_CHANNEL}, ${payload})`;
    return true;
  } catch (err) {
    console.error("Typing notify failed:", err);
    return false;
  }
}

module.exports = { notifyTyping, TYPING_CHANNEL };

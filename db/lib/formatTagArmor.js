// "Melee: Good | Ballistic: Meager" — the armour line under a tag's description (web tooltip, chip,
// Discord inspect embed, Examine). Returns null when neither armour value is set. Callers must select
// meleeArmor and ballisticArmor (ARMOR_TAG_FIELDS in db/lib/armorValue.js); a caller that forgets renders
// nothing rather than throwing. Both halves print once either exists, "None" included — don't drop the weak half.
const { armorWord } = require("./armorValue");

function formatTagArmor(tag) {
  const melee = tag?.meleeArmor;
  const ballistic = tag?.ballisticArmor;
  const hasMelee = typeof melee === "number" && melee > 0;
  const hasBallistic = typeof ballistic === "number" && ballistic > 0;
  if (!hasMelee && !hasBallistic) return null;
  return `Melee: ${armorWord(melee)} | Ballistic: ${armorWord(ballistic)}`;
}

module.exports = { formatTagArmor };

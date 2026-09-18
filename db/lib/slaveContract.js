// The Slave's contract (docs/systemdocs/CHARACTERS.md, PAPERWORK.md §6a).
//
// One sheet, minted straight into the new character's hands at creation, with
// their own name, age and gender written into it. A sibling of
// db/lib/wantedPoster.js: same shape, same hook, same reason for living
// outside the creation transaction.
//
// The 50 obols the contract names is FICTION. Nothing counts a balance and
// nothing fires when one is reached -- freeing a slave is the Exactor's act or
// a GM's, and the "Buy your freedom" Desire is claimed the ordinary way. The
// paper exists so the number is written down somewhere a player can point at.
//
// Takes `prisma`, stays off the @lifeweb/db barrel.
const { mintPaperRow } = require("./paperMint");

const CONTRACT_AUTHOR = "United Cities Customs";
const FREEDOM_PRICE_OBOLS = 50;

// The setting's current year (docs/lore.md; the "The year is 1098" pass).
// A birth year is derived rather than stored, so a character whose age the
// player never set prints UNKNOWN instead of a number computed from null --
// 1098 is not a plausible birth year for anybody standing in Ravenheart.
const CURRENT_YEAR = 1098;

function birthYear(age) {
  const n = Number(age);
  if (!Number.isFinite(n) || n <= 0) return "UNKNOWN";
  return String(CURRENT_YEAR - Math.trunc(n));
}

// The sheet says MAN/WOMAN/PERSON the way db/lib/concealedIdentity.js does,
// rather than printing the enum: a customs form is written by a person.
function genderWord(gender) {
  if (gender === "MAN") return "Man";
  if (gender === "WOMAN") return "Woman";
  return "Person";
}

function contractTitle(name) {
  return `Contract: ${name}`;
}

function contractText(character) {
  return [
    `THE SLAVE ${character.name} IS VALUED AT ${FREEDOM_PRICE_OBOLS} OBOLS. IF THEY ARE ABLE TO OBTAIN THE SET AMOUNT, THEY ARE TO BE RELEASED.`,
    "",
    `Birth Year: ${birthYear(character.age)} | Gender: ${genderWord(character.gender)}`,
    "",
    "Declared by the authority of the United Cities customs.",
    "*The worthy select, the cream of society, united in power and pleasure.*",
  ].join("\n");
}

// Its OWN transaction, deliberately. mintUnownedPaper retries on a slug
// collision, and a retry inside a caller's already-open transaction raises
// 25P02 instead of retrying (db/lib/paperMint.js) -- which is exactly why
// wantedPoster.js mints each sheet on its own too. Call this AFTER
// createCharacter's transaction has committed.
async function issueSlaveContract(prisma, character) {
  return prisma.$transaction(async (tx) =>
    mintPaperRow(tx, character.id, CONTRACT_AUTHOR, contractText(character), contractTitle(character.name)),
  );
}

module.exports = {
  CONTRACT_AUTHOR,
  FREEDOM_PRICE_OBOLS,
  birthYear,
  genderWord,
  contractTitle,
  contractText,
  issueSlaveContract,
};

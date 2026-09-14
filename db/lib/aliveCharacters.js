// A per-turn pass almost always starts by pulling every ALIVE character, then
// narrows with its own extra where keys. This is that one line, so the same
// filter isn't retyped in every *Pass.js file.
function alivePassCharacters(db, args = {}) {
  return db.character.findMany({
    ...args,
    where: { status: "ALIVE", ...(args.where || {}) },
  });
}

module.exports = { alivePassCharacters };

// Removing a Character row and everything that points at it, in FK order. Shared by the Dev Panel's
// Delete microaction and bot/src/events/guildMemberRemove.js. AuditLog.targetCharacterId and
// Note.characterId are nulled, not deleted — they keep snapshot columns. Discord cleanup happens
// BEFORE this runs (a REST walk, never inside a transaction — ARCHITECTURE.md §5).
async function deleteCharacterRow(prisma, characterId) {
  return prisma.$transaction(async (tx) => {
    await tx.auditLog.updateMany({
      where: { targetCharacterId: characterId },
      data: { targetCharacterId: null },
    });
    await tx.note.updateMany({
      where: { characterId },
      data: { characterId: null },
    });

    await tx.action.deleteMany({ where: { characterId } });
    await tx.desire.deleteMany({ where: { characterId } });
    await tx.characterTag.deleteMany({ where: { characterId } });

    return tx.character.delete({ where: { id: characterId } });
  });
}

module.exports = { deleteCharacterRow };

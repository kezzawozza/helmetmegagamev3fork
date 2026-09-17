"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { redirect } from "next/navigation";
import { prisma, loadConcealment, loadForcedName } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import {
  APPEARANCE_MAX_LENGTH,
  MAX_AVATAR_UPLOAD_BYTES,
  avatarTooBigMessage,
} from "@/lib/constants";
import { AGE_MIN, AGE_MAX, formatBareName } from "@/lib/characterName";
import { syncCharacterNickname, setTurnPingRole, ensureCharacterRole } from "@/lib/discordGuild";
import { setDiscordMirrored } from "@lifeweb/db/lib/discordMirroring";
import { clockLabel } from "@/lib/dmTime";
import { normalizeSelection } from "@/lib/portrait/catalog";
import { renderPortrait } from "@/lib/portrait/render";

const AVATAR_SIZE = 256;

// Driven by useActionState in BioForm.js, hence the leading `_prevState`.
// Returns { error } rather than throwing (web/lib/actionResult.js) — Next
// redacts a throw out of a Server Action into React error #441.
export async function updateCharacterProfile(_prevState, formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character");

  // Name and GENDER are SET AT CREATION and never read from this form again —
  // ignored here however the form is posted, same posture as `title`. Gender
  // has no unset state to leave open; only a GM can correct it from
  // /gm/dev/characters/[characterId]. The one exception for the name is the
  // Mulligan Potion (docs/tags.yaml), a CHANGE_NAME request handled by
  // requestActions.js#changeNameRequestImpl. Gender has no such exception.
  const appearance =
    formData.get("appearance")?.toString().trim().slice(0, APPEARANCE_MAX_LENGTH) || null;
  const turnPingOptIn = formData.get("turnPingOptIn") === "on";
  // "Play on Discord too" (docs/systemdocs/CHAT.md §6). NOT written with the
  // rest of the form: flipping it is a burst of Discord work on its own
  // cooldown, so it goes through db/lib/discordMirroring.js#setDiscordMirrored
  // below and only when the value actually changed — saving the Bio card
  // twice must not spend the cooldown.
  const discordMirrored = formData.get("discordMirrored") === "on";
  // The conceal toggle — no Discord side effect, the proxy pipeline resolves
  // it at send time (PROXYING.md). A forced identity (Tag.forcedName) locks
  // it off, and fixes the face, so an upload is dropped too.
  const forcedName = await loadForcedName(prisma, character.id);
  // The gear gate too — without something concealing EQUIPPED, or under
  // something that forces it, the stored preference is left exactly as it
  // was rather than rewritten by a form post.
  const concealment = forcedName ? null : await loadConcealment(prisma, character.id);
  // Whether the switch was OFFERED, the only case its value may be read.
  // AvatarField.js disables it under a forced identity, forced concealment,
  // or nothing concealing equipped — a disabled/missing checkbox reads as
  // "off", so treating it as an answer would silently clear the player's
  // standing wish (a hood taken off briefly, unrelated save). Leaving the
  // column alone is safe: concealment is derived at read time, so a stored
  // `concealed: true` with a bare face resolves to the real face on its own
  // (db/lib/presentedIdentity.js) — the preference is a wish, only the player retracts it.
  const concealOffered = Boolean(concealment) && !concealment.forced;
  const avatar = forcedName ? null : formData.get("avatar");

  // Age is set once and then fixed — a non-null age is never overwritten,
  // however the form is posted. A GM can still change it from /gm/dev/characters/[characterId].
  const rawAge = Number.parseInt(formData.get("age")?.toString() ?? "", 10);
  const age =
    Number.isInteger(rawAge) && rawAge >= AGE_MIN && rawAge <= AGE_MAX ? rawAge : null;

  const data = { appearance, turnPingOptIn };
  if (concealOffered) data.concealed = formData.get("concealed") === "on";
  if (age !== null && character.age === null) data.age = age;

  // The UI hides the file input while GameConfig.avatarUploadsEnabled is off
  // (AvatarField.js), but that's presentation only — this is the real gate.
  const gameConfig = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { avatarUploadsEnabled: true, playPanelEnabled: true },
  });
  if (gameConfig?.avatarUploadsEnabled && avatar && avatar.size > 0) {
    if (character.avatarUploadBlocked) {
      return { error: "A GM has paused avatar uploads for this character." };
    }
    if (avatar.size > MAX_AVATAR_UPLOAD_BYTES) {
      return { error: avatarTooBigMessage(avatar.size) };
    }
    try {
      const buffer = Buffer.from(await avatar.arrayBuffer());
      data.avatarData = await sharp(buffer)
        // BEFORE the resize, not after — .rotate() applies the EXIF
        // Orientation tag, and resizing first would cover-crop the unrotated
        // frame. Do NOT reach for .withMetadata() here: sharp strips metadata
        // by default and that's load-bearing — a phone photo carries GPS
        // coordinates, and /api/avatar/[characterId] serves these bytes publicly with a year-long immutable cache.
        .rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
        .webp({ quality: 85 })
        .toBuffer();
      data.avatarMimeType = "image/webp";
      // Puts them in the GM's review queue (db/lib/avatarReview.js). Stamped
      // HERE and nowhere else — not off `updatedAt`, which every rename bumps.
      data.avatarSetAt = new Date();
    } catch (err) {
      // sharp throws on anything it can't decode; accept="image/*" is a hint, not a guarantee. Nothing written yet.
      console.error("Failed to process an uploaded avatar:", err);
      return { error: "That image couldn't be read. Try a JPEG or a PNG." };
    }
  }

  const updated = await prisma.character.update({ where: { id: character.id }, data });

  // Before the Discord calls below — a refusal is returned as worded, and the rest of the save STANDS.
  let mirrorError = null;
  // While Chat is off, forcing this switch off would strand a player with no
  // way to play at all — so it's only honored when Chat is on, or the player
  // is already stranded (not mirrored) and trying to switch back to Discord.
  const playEnabled = gameConfig?.playPanelEnabled !== false;
  const mirroredWanted = playEnabled || !character.discordMirrored ? discordMirrored : true;
  if (mirroredWanted !== character.discordMirrored) {
    const flip = await setDiscordMirrored(prisma, character, mirroredWanted);
    if (!flip.ok) {
      mirrorError = flip.readyAt
        ? `You switched ${flip.minutes} minutes ago. You can switch again at ${clockLabel(
            flip.readyAt.getTime(),
          )}.`
        : flip.error;
    }
  }

  await syncCharacterNickname(session.discordUserId, formatBareName(updated)).catch(() => {});
  // A player not mirrored to Discord holds no turn-ping role
  // (db/lib/discordMirroring.js). NOT read off `updated` — written before the
  // flip above; a refused flip leaves them where they were.
  const mirroredNow = mirrorError ? character.discordMirrored : mirroredWanted;
  await setTurnPingRole(session.discordUserId, updated.turnPingOptIn && mirroredNow).catch(() => {});
  // discordMirrored not read off `updated` for the same reason as mirroredNow above.
  await ensureCharacterRole({ ...updated, discordMirrored: mirroredNow }).catch(() => {}); // self-heal: only ever creates a role that went missing
  revalidatePath("/character");
  if (mirrorError) return { error: mirrorError };
  // Has to come back from here — the upload branch is skipped when uploads
  // are off or no file was attached, and a confirmation for nothing sent would lie.
  return { ok: true, avatarUploaded: data.avatarData !== undefined };
}

// Builds and stores a portrait from a selection the modal posted — indices
// only, rendered here from committed sprite sheets so nothing the client sends can become arbitrary avatar bytes. See PORTRAITS.md.
export async function setPortraitAvatar(rawSelection) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true },
  });
  if (!character) redirect("/character");

  // The face is fixed while a forced identity is held (Tag.forcedName); the button is hidden, this is the lock.
  if (await loadForcedName(prisma, character.id)) {
    return { ok: false, error: "Your face is not yours to change right now." };
  }

  // Anything invalid, out of range, or fantasy-while-gated silently becomes the default for that slot.
  const selection = normalizeSelection(rawSelection, { allowFantasy: false });

  const avatarData = await renderPortrait(selection);

  await prisma.character.update({
    where: { id: character.id },
    data: {
      avatarData,
      avatarMimeType: "image/webp",
      portrait: JSON.stringify(selection),
      // A built face takes the upload out of the review queue with it —
      // leaving a stale timestamp would make the queue depend on two columns agreeing rather than one.
      avatarSetAt: null,
    },
  });

  revalidatePath("/character");
  return { ok: true };
}

// Drops whatever picture is set and falls back to the letter plaque. Nothing
// stored for the default — the avatar route derives it from firstName, so clearing these three columns IS the reset.
export async function resetAvatarToDefault() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true },
  });
  if (!character) redirect("/character");

  await prisma.character.update({
    where: { id: character.id },
    data: { avatarData: null, avatarMimeType: null, portrait: null, avatarSetAt: null }, // avatarSetAt goes with the picture
  });

  revalidatePath("/character");
  return { ok: true };
}


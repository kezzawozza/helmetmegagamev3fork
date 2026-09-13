"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { readBlock } from "@lifeweb/db/lib/reading";
import {
  PAPER_SLUG,
  BLANK_BOOK_SLUG,
  WRITE_MAX,
  BOOK_MAX,
  TITLE_MAX,
  isBook,
  isPaper,
  isSeal,
  paperDescription,
  paperView,
} from "@lifeweb/db/lib/paper";
import { writeNewPaper, appendToPaper, sealPaper, bindBook } from "@lifeweb/db/lib/paperMint";
import {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} from "@lifeweb/db/lib/presentedIdentity";
import { cleanCustomText } from "@/lib/customCraft";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { guarded, UserError } from "@/lib/actionResult";
import { auth } from "@/lib/auth";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";

// Writing and sealing. See docs/systemdocs/PAPERWORK.md.
//
// NEITHER FILES A REQUEST, and that is deliberate — the same call
// equipActions.js makes. Writing costs nothing, spends no Move, and is the
// single most frequent thing a scribe does; a Request per sentence would drown
// /gm/turns and /gm/audit at 100+ players, and there is nothing for a GM to
// adjudicate. What a GM needs is to READ the letters, and they can: the text
// is on the tag, and every GM surface that renders a tag renders it.
//
// The one paper verb that IS a Request is breaking a seal, because that
// destroys something and has to be undoable — it lives in requestActions.js
// with the rest of Consume.

// The same shape readBlock and paperDescription both want, resolved once.
// `needs` is a capability from db/lib/incapacitation.js. The four writing
// actions pass ACT — a pen needs a hand. readMyPaper deliberately does not:
// reading is not acting, and whether the eyes work is db/lib/reading.js's
// question, not this one.
async function requireWriter({ needs = null } = {}) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // From the session, never from a posted id: a server action is a public
  // endpoint, and an id on the wire would let anyone write on anyone's sheet.
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      concealed: true,
      updatedAt: true,
      location: { select: { indoors: true } },
      tags: {
        select: {
          tagId: true,
          quantity: true,
          equipped: true,
          tag: {
            select: {
              id: true,
              slug: true,
              name: true,
              paperKind: true,
              paperText: true,
              paperAuthor: true,
              sealMark: true,
              forcedName: true,
              ...CONCEALMENT_TAG_FIELDS,
            },
          },
        },
      },
    },
  });
  if (!character) redirect("/character");

  if (needs) {
    const blocker = blockerFor(character.tags, needs);
    if (blocker) throw new UserError(`You can't do that right now. You're ${blocker.name}.`);
  }

  const turn = await prisma.turn.findFirst({
    where: { status: "OPEN" },
    orderBy: { number: "desc" },
    select: { phase: true },
  });

  return {
    session,
    character,
    where: { phase: turn?.phase ?? null, indoors: character.location?.indoors ?? true },
  };
}

function revalidateAll() {
  revalidatePath("/character");
  revalidatePath("/faction");
}

// Who signs the paper, internally. The PRESENTED name, so a hooded writer does
// not put their real one on a sheet somebody may later find — and so a forced
// name (Apex Form) writes as the Beast. Never rendered to another player: it
// only tells a GM whose hand it was, since Tag.name is deliberately anonymous
// (db/lib/paper.js#paperName). Read off the tags already loaded rather than
// through loadForcedName, so this costs no second query.
function writerName(character) {
  return presentedIdentity(character, {
    forcedName: forcedNameFrom(character.tags),
    concealment: concealmentFrom(character.tags),
  }).name;
}

async function writePaperImpl({ tagId: rawTagId, text: rawText, title: rawTitle }) {
  const { character, where } = await requireWriter({ needs: ACT });

  if (readBlock(character.tags, where)) {
    // The same sentence a paper shows a reader who can't read it. Saying
    // WHICH of letters or eyes stopped them would leak a condition.
    throw new UserError("You can't read this.");
  }

  const targetId = String(rawTagId ?? "");
  const held = character.tags.find((ct) => ct.tagId === targetId);
  if (!held) throw new UserError("You aren't holding that.");

  // A book holds six times what a sheet does, and it is the whole thing in one
  // pass — there is no second visit to add a chapter.
  const writingBook = held.tag.slug === BLANK_BOOK_SLUG;
  const text = String(rawText ?? "").trim().slice(0, writingBook ? BOOK_MAX : WRITE_MAX);
  if (!text) throw new UserError("Write something first.");

  // A book must be named and a sheet may be. Blank on a sheet is a legal
  // answer and leaves it "A Note" (db/lib/paper.js#paperName), which is what
  // every sheet was called before this existed.
  //
  // CLEANED, NOT JUST TRIMMED. A paper's name is interpolated straight into
  // bot messages — the noticeboard's "You put X up." and the Bird's "The bird
  // is away with X." — so an unscrubbed title is a Discord mention waiting to
  // happen. cleanCustomText is the custom-craft mint's own scrubber and takes
  // "@", "{" and "}" out for exactly this reason; it was never run on a book
  // title, which is a hole this closes on the way past.
  const title = cleanCustomText(rawTitle, TITLE_MAX) || null;
  if (writingBook && !title) throw new UserError("Give it a title first.");

  const hand = writerName(character);

  let result;
  await prisma.$transaction(async (tx) => {
    // A blank book becomes a written one. Locked and re-counted inside the
    // transaction for the reason dropCharacterTag makes necessary: it CLAMPS
    // rather than failing, so two submits a millisecond apart would both pass
    // a check made outside and the second would mint a free book.
    if (writingBook) {
      const [locked] = await tx.$queryRaw`
        SELECT "quantity" FROM "CharacterTag"
        WHERE "characterId" = ${character.id} AND "tagId" = ${held.tagId}
        FOR UPDATE`;
      if (!locked || locked.quantity < 1) throw new UserError("You aren't holding that.");
      result = await bindBook(tx, { id: character.id, name: hand }, held.tagId, title, text);
      return;
    }
    // A blank sheet becomes a written one: a unit off the stack, a new row.
    if (held.tag.slug === PAPER_SLUG) {
      result = await writeNewPaper(tx, { id: character.id, name: hand }, held.tagId, text, title);
      return;
    }
    // Writing more on a sheet that already has words on it. APPEND-ONLY —
    // nothing anywhere in the game shortens paperText.
    if (held.tag.paperKind === "PAPER") {
      result = await appendToPaper(tx, held.tagId, held.tag.paperText, text);
      return;
    }
    if (held.tag.paperKind === "SEALED") {
      throw new UserError("It's sealed. Break the seal first.");
    }
    // The one rule a book has that a sheet does not. What is bound in is what
    // it says; there is no page left to add.
    if (isBook(held.tag)) {
      throw new UserError("It's bound. You'd have to tear it up and start again.");
    }
    throw new UserError("You can't write on that.");
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { name: result.name, tagId: result.id };
}

async function sealLetterImpl({ tagId: rawTagId, stampTagId: rawStampId, title: rawTitle }) {
  const { character } = await requireWriter({ needs: ACT });

  const paperRow = character.tags.find((ct) => ct.tagId === String(rawTagId ?? ""));
  const stampRow = character.tags.find((ct) => ct.tagId === String(rawStampId ?? ""));

  if (!paperRow || !stampRow) throw new UserError("You aren't holding that.");
  if (!isSeal(stampRow.tag)) throw new UserError("That isn't a wax stamp.");
  if (!isPaper(paperRow.tag) || paperRow.tag.paperKind !== "PAPER") {
    throw new UserError("That isn't a letter you can seal.");
  }
  // A blank sheet folded shut is a joke, not a letter, and it would put an
  // unreadable "Blank paper" behind a seal somebody has to break to find out.
  if (!(paperRow.tag.paperText ?? "").trim()) throw new UserError("There's nothing written on it.");

  // Sealing does not need literacy — pressing wax into a fold is not reading —
  // but it does need the paper, and holding it is the check.
  // A sheet that reached this hand untitled may be labelled on the way into
  // the wax — a courier with a bundle of anonymous letters is exactly who
  // needs to tell them apart. Scrubbed the same way the Write dialog scrubs a
  // title, because the name reaches Discord through the noticeboard and the
  // Bird, where an unscrubbed "@everyone" is a real mention.
  //
  // sealPaper enforces the rest: a sheet that already has a title keeps it,
  // whatever was posted here, so a second hand cannot rename a first hand's
  // letter. The dialog hides the field in that case; this is the lock.
  const title = cleanCustomText(rawTitle, TITLE_MAX) || null;

  let sealed;
  await prisma.$transaction(async (tx) => {
    sealed = await sealPaper(tx, paperRow.tag, stampRow.tag, { title });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { name: sealed.name };
}

// --- public surface ---------------------------------------------------

export async function writePaper(input) {
  return guarded(() => writePaperImpl(input));
}

export async function sealLetter(input) {
  return guarded(() => sealLetterImpl(input));
}

// What the Write dialog needs that the sheet does not already hold: the text
// of a paper the caller can read, so the box can show it above the cursor.
// Composed through paperDescription so a reader who has since gone blind, or
// left their spectacles somewhere, gets the same refusal here as everywhere.
export async function readMyPaper(rawTagId) {
  const { character, where } = await requireWriter();
  const held = character.tags.find((ct) => ct.tagId === String(rawTagId ?? ""));
  if (!held || !isPaper(held.tag)) return { ok: false, error: "You aren't holding that." };
  const reader = { tags: character.tags, ...where };
  return {
    ok: true,
    text: paperDescription(held.tag, reader),
    paper: paperView(held.tag, reader),
    kind: held.tag.paperKind,
  };
}

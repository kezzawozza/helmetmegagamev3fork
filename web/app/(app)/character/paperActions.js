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

// Writing and sealing. See docs/systemdocs/PAPERWORK.md. NEITHER FILES A REQUEST (same call equipActions.js makes): writing costs nothing, spends no Move, and a Request per sentence would drown /gm/turns and /gm/audit at 100+ players — a GM just reads the tag's text, which every GM surface already renders.
// Breaking a seal IS a Request (destroys something, must be undoable) and lives in requestActions.js with the rest of Consume.

// `needs` (db/lib/incapacitation.js): the four writing actions pass ACT — a pen needs a hand. readMyPaper does not: reading isn't acting, and whether the eyes work is db/lib/reading.js's question.
async function requireWriter({ needs = null } = {}) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // From the session, never a posted id: a server action is a public endpoint, and an id on the wire would let anyone write on anyone's sheet.
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

// Who signs the paper, internally: the PRESENTED name, so a hooded writer doesn't put their real one on a sheet somebody may find, and a forced name (Apex Form) writes as the Beast. Never shown to another player — only tells a GM whose hand it was, since Tag.name is deliberately anonymous (db/lib/paper.js#paperName).
function writerName(character) {
  return presentedIdentity(character, {
    forcedName: forcedNameFrom(character.tags),
    concealment: concealmentFrom(character.tags),
  }).name;
}

async function writePaperImpl({ tagId: rawTagId, text: rawText, title: rawTitle }) {
  const { character, where } = await requireWriter({ needs: ACT });

  if (readBlock(character.tags, where)) {
    // Same sentence a paper shows a reader who can't read it — naming WHICH of letters or eyes stopped them would leak a condition.
    throw new UserError("You can't read this.");
  }

  const targetId = String(rawTagId ?? "");
  const held = character.tags.find((ct) => ct.tagId === targetId);
  if (!held) throw new UserError("You aren't holding that.");

  // A book holds six times what a sheet does, and is the whole thing in one pass — no second visit to add a chapter.
  const writingBook = held.tag.slug === BLANK_BOOK_SLUG;
  const text = String(rawText ?? "").trim().slice(0, writingBook ? BOOK_MAX : WRITE_MAX);
  if (!text) throw new UserError("Write something first.");

  // A book must be named; a sheet may be (blank leaves it "A Note", db/lib/paper.js#paperName). CLEANED, NOT JUST TRIMMED: a paper's name is interpolated into bot messages (noticeboard, Bird), so an unscrubbed title is a Discord mention waiting to happen — cleanCustomText strips "@", "{" and "}" for exactly this reason.
  const title = cleanCustomText(rawTitle, TITLE_MAX) || null;
  if (writingBook && !title) throw new UserError("Give it a title first.");

  const hand = writerName(character);

  let result;
  await prisma.$transaction(async (tx) => {
    // A blank book becomes a written one. Locked and re-counted inside the transaction: dropCharacterTag CLAMPS rather than failing, so two submits a millisecond apart would both pass an outside check and the second would mint a free book.
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
    // Writing more on a sheet with words on it. APPEND-ONLY — nothing anywhere in the game shortens paperText.
    if (held.tag.paperKind === "PAPER") {
      result = await appendToPaper(tx, held.tagId, held.tag.paperText, text);
      return;
    }
    if (held.tag.paperKind === "SEALED") {
      throw new UserError("It's sealed. Break the seal first.");
    }
    // The one rule a book has that a sheet doesn't: what's bound in is what it says, no page left to add.
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
  // A blank sheet folded shut is a joke, not a letter — it would put an unreadable "Blank paper" behind a seal somebody has to break to find out.
  if (!(paperRow.tag.paperText ?? "").trim()) throw new UserError("There's nothing written on it.");

  // Sealing needs no literacy (pressing wax into a fold isn't reading) but does need the paper, so holding it is the check. An untitled sheet may be labelled here (a courier with anonymous letters needs to tell them apart), scrubbed like the Write dialog scrubs a title since it reaches Discord via the noticeboard and the Bird.
  // sealPaper enforces the rest: a sheet that already has a title keeps it regardless of what's posted here, so a second hand can't rename a first hand's letter.
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

// The text of a paper the caller can read, for the Write dialog's box. Composed through paperDescription so a reader who's since gone blind or left their spectacles gets the same refusal here as everywhere.
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

-- Per-character brake on the avatar upload branch.
ALTER TABLE "Character" ADD COLUMN "avatarUploadBlocked" BOOLEAN NOT NULL DEFAULT false;

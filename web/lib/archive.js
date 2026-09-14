import { prisma } from "@lifeweb/db";
import {
  recordArchiveEvent as record,
  recordArchiveMessage as recordMessage,
} from "@lifeweb/db/lib/archive";

// Thin shim binding the singleton prisma. A transcript row is never worth failing a player's
// action over. Call these OUTSIDE a transaction.
export function recordArchiveEvent(entry) {
  return record(prisma, entry);
}

export function recordArchiveMessage(entry) {
  return recordMessage(prisma, entry);
}

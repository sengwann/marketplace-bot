import type { Telegram } from "telegraf";
import { adminText, isNotModified, pendingKeyboard } from "./adminView";
import { config } from "./config";
import { prisma } from "./db";
import { channelCaption, formatPrice } from "./format";
import type { Listing } from "./generated/prisma/client";
import { logger } from "./logger";
import { withRetryAfter } from "./telegramRetry";
import type { Category, Currency, Location } from "./types";
import { escapeHtml, generatePublicId } from "./util";

// All listing logic lives here: create, notify admins, approve, reject, edit,
// sold out. Every status change is ONE atomic "update ... where status = X"
// so two clicks can never both win.

// Sends to the admin group and the channel go through this: if Telegram says "too many
// requests", wait the time it asks for and try again (see telegramRetry.ts).
const patient = <T>(fn: () => Promise<T>): Promise<T> =>
  withRetryAfter(fn, {
    onWait: (seconds) =>
      logger.warn({ waitSeconds: seconds }, "Telegram asked us to slow down, waiting"),
  });

/** An error whose message is safe to show to an admin. */
export class UserError extends Error {}

const ALREADY_PROCESSED = "ဤပစ္စည်းကို စီမံပြီးသား ဖြစ်ပါသည်။";

// ------------------------------------------------------------
// Create
// ------------------------------------------------------------

export interface NewListing {
  submissionKey: string;
  sellerTelegramId: bigint;
  sellerUsername: string | null;
  sellerFirstName: string | null;
  productName: string;
  category: Category;
  location: Location;
  priceAmount: number;
  currency: Currency;
  condition: string;
  note: string | null;
  contact: string;
  photoFileIds: string[];
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

/**
 * Saves a listing. If the same submissionKey was already saved (the seller
 * double-tapped Submit), returns the existing one with created = false.
 */
export async function createListing(
  input: NewListing,
): Promise<{ listing: Listing; created: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const listing = await prisma.listing.create({
        data: { ...input, publicId: generatePublicId() },
      });
      return { listing, created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;

      // Either this is a double-tap (same submissionKey) or, very rarely,
      // the random public ID collided. Check which one it was.
      const existing = await prisma.listing.findUnique({
        where: { submissionKey: input.submissionKey },
      });
      if (existing) return { listing: existing, created: false };
      // Otherwise: ID collision -> loop and try a new ID.
    }
  }
  throw new Error("Could not generate a unique listing ID.");
}

/**
 * Has this seller used up their listings for the last 24 hours?
 * Every status counts (a rejected listing still used up a slot), otherwise
 * someone could keep flooding the admins with listings that get rejected.
 * Admins and a limit of 0 are never limited.
 */
export async function isOverDailyLimit(telegramId: number): Promise<boolean> {
  const limit = config.dailyListingLimit;
  if (limit === 0 || config.adminUserIds.includes(telegramId)) return false;

  const used = await prisma.listing.count({
    where: {
      sellerTelegramId: BigInt(telegramId),
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  return used >= limit;
}

export function findById(id: string): Promise<Listing | null> {
  return prisma.listing.findUnique({ where: { id } });
}

export function findByPublicId(publicId: string): Promise<Listing | null> {
  return prisma.listing.findUnique({ where: { publicId } });
}

// ------------------------------------------------------------
// Telegram helpers
// ------------------------------------------------------------

/** Sends 1 photo, or an album of 2-6. Returns the first message's ID. */
async function sendPhotos(
  telegram: Telegram,
  chatId: string | number,
  fileIds: string[],
  caption?: string,
  replyToMessageId?: number,
): Promise<number> {
  const reply = replyToMessageId
    ? { reply_parameters: { message_id: replyToMessageId } }
    : {};

  // Telegram's album API wants 2-10 items, so a single photo is sent on its own.
  if (fileIds.length === 1) {
    const message = await patient(() =>
      telegram.sendPhoto(chatId, fileIds[0], {
        ...(caption ? { caption, parse_mode: "HTML" as const } : {}),
        ...reply,
      }),
    );
    return message.message_id;
  }

  const media = fileIds.map((fileId, index) => ({
    type: "photo" as const,
    media: fileId,
    ...(index === 0 && caption ? { caption, parse_mode: "HTML" as const } : {}),
  }));
  const messages = await patient(() => telegram.sendMediaGroup(chatId, media, reply));
  return messages[0].message_id;
}

// ------------------------------------------------------------
// Admin group notification
// ------------------------------------------------------------

/**
 * Posts the listing to the admin group: the photos first, then the text + buttons
 * as a reply to them (so the control message sits at the bottom, under the photos).
 *
 * adminNotifiedAt is only set once the text is delivered, and the text is only sent
 * after the photos succeeded. So "admins can see the buttons" always means "admins
 * can see the photos", and anything that failed on the way is picked up by the retry
 * job (retry.ts). Worst case after a failure between the two sends: the retry sends
 * the photos a second time. That is harmless noise, never a missing photo.
 */
export async function notifyAdmins(telegram: Telegram, listing: Listing): Promise<void> {
  const photoMessageId = await sendPhotos(
    telegram,
    config.adminChatId,
    listing.photoFileIds,
  );

  const sent = await patient(() =>
    telegram.sendMessage(config.adminChatId, adminText(listing), {
      parse_mode: "HTML",
      reply_parameters: { message_id: photoMessageId },
      ...pendingKeyboard(listing.id),
    }),
  );

  await prisma.listing.update({
    where: { id: listing.id },
    data: { adminMessageId: BigInt(sent.message_id), adminNotifiedAt: new Date() },
  });
}

// ------------------------------------------------------------
// Approve / reject
// ------------------------------------------------------------

export async function approveListing(telegram: Telegram, id: string): Promise<Listing> {
  // Claim it first. Only one click can flip PENDING -> APPROVED, so a
  // double-click can never post to the channel twice.
  const claimed = await prisma.listing.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "APPROVED" },
  });
  if (claimed.count !== 1) throw new UserError(ALREADY_PROCESSED);

  const listing = await prisma.listing.findUniqueOrThrow({ where: { id } });

  let channelMessageId: number;
  try {
    channelMessageId = await sendPhotos(
      telegram,
      config.channelId,
      listing.photoFileIds,
      channelCaption(listing),
    );
  } catch (err) {
    // Nothing was posted, so put it back and let an admin try again.
    await prisma.listing.updateMany({
      where: { id, status: "APPROVED", channelMessageId: null },
      data: { status: "PENDING" },
    });
    throw err;
  }

  return prisma.listing.update({
    where: { id },
    data: { channelMessageId: BigInt(channelMessageId) },
  });
}

export async function rejectListing(id: string, reason: string): Promise<Listing> {
  const rejected = await prisma.listing.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", rejectionReason: reason },
  });
  if (rejected.count !== 1) throw new UserError(ALREADY_PROCESSED);

  return prisma.listing.findUniqueOrThrow({ where: { id } });
}

// ------------------------------------------------------------
// Admin edits (only while PENDING; saved immediately, no draft)
// ------------------------------------------------------------

export interface PendingPatch {
  productName?: string;
  category?: Category;
  location?: Location;
  priceAmount?: number;
  currency?: Currency;
  condition?: string;
  note?: string | null;
  contact?: string;
}

export async function updatePending(id: string, patch: PendingPatch): Promise<Listing> {
  const updated = await prisma.listing.updateMany({
    where: { id, status: "PENDING" },
    data: patch,
  });
  if (updated.count !== 1) throw new UserError(ALREADY_PROCESSED);

  return prisma.listing.findUniqueOrThrow({ where: { id } });
}

// ------------------------------------------------------------
// Sold out / available
// ------------------------------------------------------------

export async function setAvailability(
  telegram: Telegram,
  id: string,
  availability: "AVAILABLE" | "SOLD_OUT",
): Promise<Listing> {
  const updated = await prisma.listing.updateMany({
    where: { id, status: "APPROVED" },
    data: { availability },
  });
  if (updated.count !== 1) {
    throw new UserError("အတည်ပြုပြီးသော ပစ္စည်းများကိုသာ ပြောင်းလဲနိုင်ပါသည်။");
  }

  const listing = await prisma.listing.findUniqueOrThrow({ where: { id } });

  if (listing.channelMessageId !== null) {
    try {
      await telegram.editMessageCaption(
        config.channelId,
        Number(listing.channelMessageId),
        undefined,
        channelCaption(listing),
        { parse_mode: "HTML" },
      );
    } catch (err) {
      if (!isNotModified(err)) {
        logger.error({ err, listingId: id }, "Channel caption edit failed");
        // DB is already updated; running the same command again retries the edit.
        throw new UserError(
          "Database ပြောင်းပြီးပါပြီ၊ သို့သော် Channel post ကို ပြင်၍ မရပါ။ ထပ်မံကြိုးစားပါ။",
        );
      }
    }
  }

  return listing;
}

// ------------------------------------------------------------
// Messages to the seller (best effort: failures are only logged)
// ------------------------------------------------------------

export async function notifySellerApproved(telegram: Telegram, l: Listing): Promise<void> {
  try {
    await telegram.sendMessage(
      l.sellerTelegramId.toString(),
      `✅ <b>သင့်ပစ္စည်းကို အတည်ပြုပြီးပါပြီ</b>\n\n` +
        `📦 <b>ပစ္စည်းအမည်:</b> ${escapeHtml(l.productName)}\n` +
        `💰 <b>ဈေးနှုန်း:</b> ${escapeHtml(formatPrice(l))}\n\n` +
        `📢 သင့်ပစ္စည်းကို Channel တွင် ဖော်ပြပြီးပါပြီ။\n` +
        `🧾 ID: <code>${escapeHtml(l.publicId)}</code>`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.warn({ err, listingId: l.id }, "Could not notify seller (approved)");
  }
}

export async function notifySellerRejected(telegram: Telegram, l: Listing): Promise<void> {
  try {
    await telegram.sendMessage(
      l.sellerTelegramId.toString(),
      `❌ <b>သင့်ပစ္စည်းကို ပယ်ဖျက်လိုက်ပါသည်</b>\n\n` +
        `📦 <b>ပစ္စည်းအမည်:</b> ${escapeHtml(l.productName)}\n` +
        `💰 <b>ဈေးနှုန်း:</b> ${escapeHtml(formatPrice(l))}\n\n` +
        `📝 <b>အကြောင်းပြချက်:</b>\n${escapeHtml(l.rejectionReason)}`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.warn({ err, listingId: l.id }, "Could not notify seller (rejected)");
  }
}

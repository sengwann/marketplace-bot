-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('AVAILABLE', 'SOLD_OUT');

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "submission_key" TEXT NOT NULL,
    "seller_telegram_id" BIGINT NOT NULL,
    "seller_username" TEXT,
    "seller_first_name" TEXT,
    "product_name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "price_amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "note" TEXT,
    "contact" TEXT NOT NULL,
    "photo_file_ids" TEXT[],
    "status" "ListingStatus" NOT NULL DEFAULT 'PENDING',
    "availability" "Availability" NOT NULL DEFAULT 'AVAILABLE',
    "rejection_reason" TEXT,
    "admin_message_id" BIGINT,
    "admin_notified_at" TIMESTAMP(3),
    "channel_message_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_sessions" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_sessions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "listings_public_id_key" ON "listings"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "listings_submission_key_key" ON "listings"("submission_key");

-- CreateIndex
CREATE INDEX "listings_status_admin_notified_at_created_at_idx" ON "listings"("status", "admin_notified_at", "created_at");

-- CreateIndex
CREATE INDEX "listings_seller_telegram_id_idx" ON "listings"("seller_telegram_id");

-- CreateIndex
CREATE INDEX "bot_sessions_expires_at_idx" ON "bot_sessions"("expires_at");

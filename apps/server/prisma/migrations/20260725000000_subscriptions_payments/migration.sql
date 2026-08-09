-- Phase 4 Feature K — Monetization schema (Razorpay + Apple IAP).
--
-- Subscription: one row per paying user (the household primary on a
-- family plan; userId UNIQUE). PaymentEvent: append-only, signature-
-- verified webhook/receipt audit log.
--
-- Retention: BOTH tables are retained 7 years (Indian tax law) and are
-- ANONYMISED — not cascade-deleted — on user erasure. Hence userId is
-- nullable with ON DELETE SET NULL, overriding the illustrative
-- `onDelete: Cascade` in the phase4.md K.1 snippet.

-- CreateEnum
CREATE TYPE "SubscriptionProvider" AS ENUM ('razorpay', 'apple_iap', 'manual');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'past_due', 'grace', 'cancelled');

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "tier" "Tier" NOT NULL,
    "provider" "SubscriptionProvider" NOT NULL,
    "provider_subscription_id" TEXT,
    "status" "SubscriptionStatus" NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "provider" "SubscriptionProvider" NOT NULL,
    "event_type" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "processed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "subscriptions_provider_subscription_id_idx" ON "subscriptions"("provider_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "payment_events_user_id_created_at_idx" ON "payment_events"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_events_provider_event_type_idx" ON "payment_events"("provider", "event_type");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

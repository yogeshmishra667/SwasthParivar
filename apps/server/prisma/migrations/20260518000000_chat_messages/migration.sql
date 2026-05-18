-- Phase 3 step A.1 — AI Chat (ChatSession + ChatMessage).
--
-- Patient-facing Claude chat. Idempotent on `client_uuid` from mobile so
-- a retry during a network blip never produces a duplicate row — the
-- service replays the persisted response instead of re-calling Claude.
--
-- Retention (DPDP, CC.11 §5 in phase3.md): archived_at is set at 90 days
-- by the CHAT_RETENTION_SWEEP cron; the row is hard-deleted at 1 year.
-- Cascade on user delete handles right-to-be-forgotten via the existing
-- onDelete: Cascade chain on User.

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('user', 'assistant', 'system');

-- CreateEnum
CREATE TYPE "ChatCostTier" AS ENUM ('template', 'cached', 'sonnet');

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "language" "Language" NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "client_uuid" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "referenced_readings" JSONB,
    "tokens_input" INTEGER NOT NULL DEFAULT 0,
    "tokens_output" INTEGER NOT NULL DEFAULT 0,
    "cost_tier" "ChatCostTier" NOT NULL,
    "response_latency_ms" INTEGER,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flag_reason" TEXT,
    "safety_violations" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_started_at_idx" ON "chat_sessions"("user_id", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_client_uuid_key" ON "chat_messages"("client_uuid");

-- CreateIndex
CREATE INDEX "chat_messages_user_id_created_at_idx" ON "chat_messages"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_messages_flagged_created_at_idx" ON "chat_messages"("flagged", "created_at");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

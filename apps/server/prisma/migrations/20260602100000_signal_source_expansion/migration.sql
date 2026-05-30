-- Phase 4 §C' — Silent Guardian signal-source expansion.
--
-- Extends the `SignalSource` Postgres enum with the four new sources
-- specced in CLAUDE.md "Silent Guardian → Signals":
--   chat_sentiment, schedule_miss, activity_drop, cross_signal.
--
-- ALTER TYPE ... ADD VALUE is additive and Postgres-safe — existing
-- rows + columns of type SignalSource keep working unchanged. Each
-- ADD VALUE is its own statement (Postgres requires non-transactional
-- application for ADD VALUE inside a transaction block). AFTER is
-- specified on each new value so squawk's require-enum-value-ordering
-- rule is satisfied and the ordering is deterministic across envs.

ALTER TYPE "SignalSource" ADD VALUE IF NOT EXISTS 'chat_sentiment' AFTER 'data_anomaly';
ALTER TYPE "SignalSource" ADD VALUE IF NOT EXISTS 'schedule_miss' AFTER 'chat_sentiment';
ALTER TYPE "SignalSource" ADD VALUE IF NOT EXISTS 'activity_drop' AFTER 'schedule_miss';
ALTER TYPE "SignalSource" ADD VALUE IF NOT EXISTS 'cross_signal' AFTER 'activity_drop';

-- Audit P33 — a critical glucose reading over 2 hours old when it reaches
-- the server (offline queue) is stored with this feedback
-- type instead of `critical_warn`, which is what the critical cooldown looks
-- for: an old reading must not start it, or a real critical reading soon
-- after would reach nobody.
--
-- ALTER TYPE ... ADD VALUE is additive: existing rows keep working.

ALTER TYPE "FeedbackType" ADD VALUE IF NOT EXISTS 'critical_warn_late' AFTER 'critical_warn';

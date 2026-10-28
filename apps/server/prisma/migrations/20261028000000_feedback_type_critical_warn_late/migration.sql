-- Audit P33 — a critical glucose reading that reaches the server more than
-- 2 hours after it was taken (offline queue) is stored with this feedback
-- type instead of `critical_warn`. `critical_warn` is what the critical
-- cooldown, guardian-alert dedup and chat's active-emergency check look
-- for; a late reading must not trigger any of them, or a real critical
-- reading soon after would reach nobody.
--
-- ALTER TYPE ... ADD VALUE is additive: existing rows keep working.

ALTER TYPE "FeedbackType" ADD VALUE IF NOT EXISTS 'critical_warn_late' AFTER 'critical_warn';

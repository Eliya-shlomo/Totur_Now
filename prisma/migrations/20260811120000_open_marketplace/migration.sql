-- ═══════════════════════════════════════════════════════════════════════════════
-- The 8/11 revision: the platform stops gatekeeping and starts describing.
--
-- Three product decisions land here at once, because they are one decision:
--
--   1. The teacher sets their own price (MVP.md §5.2). No price_tier — the
--      student-facing band is derived from price_per_block at read time.
--   2. Standing replaces credentials (§6.2). No badge column — it is a function
--      of sessions_count and the rating columns, computed on read.
--   3. Signup is open (§6.1). No entrance exam, no documents, no admin approval.
--
-- Written by hand rather than generated, because a generated diff would drop the
-- partial index and the CHECK below without saying so, and both are load-bearing.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. tables that no longer exist ─────────────────────────────────────────────
DROP TABLE IF EXISTS "entrance_attempts";
DROP TABLE IF EXISTS "entrance_questions";
DROP TABLE IF EXISTS "teacher_documents";

-- ── 2. columns on teacher_profiles ─────────────────────────────────────────────
ALTER TABLE "teacher_profiles"
  DROP COLUMN IF EXISTS "badge",
  DROP COLUMN IF EXISTS "price_tier",
  DROP COLUMN IF EXISTS "entrance_score",
  DROP COLUMN IF EXISTS "academic_email",
  DROP COLUMN IF EXISTS "academic_verified",
  DROP COLUMN IF EXISTS "admin_verified";

-- The enums die with their columns. Dropping them is what stops a later
-- `migrate dev` from seeing an unused type and asking about it.
DROP TYPE IF EXISTS "teacher_badge";
DROP TYPE IF EXISTS "price_tier";

-- ── 3. price becomes the teacher's own, within bounds ──────────────────────────
-- Default 8 was the BASE tier. 10 is the middle of the new ₪5–20 range, so a
-- teacher who never touches the setting sits in the middle of the market rather
-- than at the bottom of it.
ALTER TABLE "teacher_profiles"
  ALTER COLUMN "price_per_block" SET DEFAULT 10;

-- Any existing row outside the new range is pulled into it before the constraint
-- goes on. Nothing is live yet, so this is belt-and-braces — but a CHECK that can
-- fail on ADD is a migration that fails in production, which is exactly when it
-- matters most.
UPDATE "teacher_profiles" SET "price_per_block" = 5  WHERE "price_per_block" < 5;
UPDATE "teacher_profiles" SET "price_per_block" = 20 WHERE "price_per_block" > 20;

-- HAND-ADDED: CHECK constraint. MVP.md §5.2 — Prisma models no CHECK at all, so
-- this exists only here. The Zod validator enforces the same range at the edge;
-- this is the line that holds when something reaches the table another way.
ALTER TABLE "teacher_profiles"
  ADD CONSTRAINT "teacher_profiles_price_per_block_check"
  CHECK ("price_per_block" BETWEEN 5 AND 20);

-- ── 4. the matching index gains price ──────────────────────────────────────────
-- HAND-ADDED: WHERE clause, same reasoning as the init migration. price_per_block
-- joins the index because the student's price band is now a hard filter (§9.1),
-- evaluated on every matching run alongside status and level.
DROP INDEX IF EXISTS "idx_teacher_available";
CREATE INDEX "idx_teacher_available"
  ON "teacher_profiles"("status", "level_max", "price_per_block")
  WHERE "status" = 'ONLINE';

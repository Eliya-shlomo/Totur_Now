-- ═══════════════════════════════════════════════════════════════════════════
-- HAND-EDITED after generation. Do not regenerate this file.
--
-- Five objects in MVP.md §11.2 cannot be expressed in the Prisma schema
-- language, so they are written in by hand below and marked `HAND-ADDED`:
--
--   * three partial indexes — Prisma emits the index, the WHERE clause is added
--     here (idx_teacher_available, idx_sessions_active, idx_offers_pending)
--   * two CHECK constraints — Prisma emits nothing at all
--     (wallets.balance >= 0, reviews.stars between 1 and 5)
--
-- None of the five is declared in prisma/schema/. Prisma models neither check
-- constraints nor index predicates, and it does not see a partial index when it
-- reads the database — so declaring the indexes there without their WHERE clause
-- makes every later `migrate dev` emit a CREATE INDEX for a name that already
-- exists. Leaving them out entirely is what keeps `migrate diff` empty.
--
-- Verified with:
--   npx prisma migrate diff --from-schema-datasource prisma/schema/schema.prisma \
--                           --to-schema-datamodel prisma/schema --script
-- which prints "This is an empty migration." Re-run it after any schema change,
-- and read the generated SQL before applying it.
-- ═══════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('PENDING', 'OFFER_SENT', 'ACTIVE', 'ENDED', 'RATED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "teacher_status" AS ENUM ('OFFLINE', 'ONLINE', 'OFFER_LOCKED', 'IN_SESSION');

-- CreateEnum
CREATE TYPE "teacher_badge" AS ENUM ('NEW', 'STUDENT', 'CERTIFIED');

-- CreateEnum
CREATE TYPE "price_tier" AS ENUM ('BASE', 'REGULAR', 'PRO');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('student', 'teacher', 'admin');

-- CreateEnum
CREATE TYPE "tx_type" AS ENUM ('TOPUP', 'SESSION_CHARGE', 'REFUND', 'TEACHER_EARNING', 'PAYOUT', 'PROMO');

-- CreateTable
CREATE TABLE "entrance_questions" (
    "id" SERIAL NOT NULL,
    "level" SMALLINT,
    "topic_id" INTEGER,
    "body" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct_index" SMALLINT NOT NULL,

    CONSTRAINT "entrance_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entrance_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "teacher_id" UUID,
    "score" SMALLINT,
    "answers" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entrance_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID,
    "raw_text" TEXT NOT NULL,
    "title" VARCHAR(160),
    "topic_id" INTEGER,
    "subtopic_id" INTEGER,
    "difficulty" SMALLINT,
    "estimated_level" SMALLINT,
    "teacher_brief" TEXT,
    "llm_confidence" DECIMAL(3,2),
    "classification_ok" BOOLEAN NOT NULL DEFAULT true,
    "rejected_by" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "question_id" UUID,
    "file_url" TEXT NOT NULL,
    "mime_type" VARCHAR(60),

    CONSTRAINT "question_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "question_id" UUID,
    "student_id" UUID,
    "teacher_id" UUID,
    "status" "session_status" NOT NULL DEFAULT 'PENDING',
    "price_per_block" INTEGER,
    "budget_cap" INTEGER NOT NULL DEFAULT 40,
    "blocks_used" SMALLINT NOT NULL DEFAULT 0,
    "total_charged" INTEGER NOT NULL DEFAULT 0,
    "platform_fee" INTEGER NOT NULL DEFAULT 0,
    "teacher_earning" INTEGER NOT NULL DEFAULT 0,
    "zoom_join_url" TEXT,
    "zoom_meeting_id" VARCHAR(60),
    "started_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "end_reason" VARCHAR(40),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID,
    "block_number" SMALLINT,
    "minutes" SMALLINT,
    "amount" INTEGER,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID,
    "teacher_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID,
    "student_id" UUID,
    "teacher_id" UUID,
    "is_resolved" BOOLEAN NOT NULL,
    "stars" SMALLINT,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_profiles" (
    "user_id" UUID NOT NULL,
    "bio" TEXT,
    "badge" "teacher_badge" NOT NULL DEFAULT 'NEW',
    "price_tier" "price_tier" NOT NULL DEFAULT 'BASE',
    "price_per_block" INTEGER NOT NULL DEFAULT 8,
    "status" "teacher_status" NOT NULL DEFAULT 'OFFLINE',
    "level_max" SMALLINT NOT NULL DEFAULT 3,
    "entrance_score" SMALLINT,
    "academic_email" VARCHAR(255),
    "academic_verified" BOOLEAN NOT NULL DEFAULT false,
    "admin_verified" BOOLEAN NOT NULL DEFAULT false,
    "zoom_personal_link" TEXT,
    "sessions_count" INTEGER NOT NULL DEFAULT 0,
    "resolved_count" INTEGER NOT NULL DEFAULT 0,
    "offers_received" INTEGER NOT NULL DEFAULT 0,
    "offers_accepted" INTEGER NOT NULL DEFAULT 0,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "no_show_count" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" SERIAL NOT NULL,
    "parent_id" INTEGER,
    "name_he" VARCHAR(80) NOT NULL,
    "name_en" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_topics" (
    "teacher_id" UUID NOT NULL,
    "topic_id" INTEGER NOT NULL,

    CONSTRAINT "teacher_topics_pkey" PRIMARY KEY ("teacher_id","topic_id")
);

-- CreateTable
CREATE TABLE "teacher_topic_stats" (
    "teacher_id" UUID NOT NULL,
    "topic_id" INTEGER NOT NULL,
    "rating_sum" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "rating_count" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "resolved_count" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "sessions_count" DECIMAL(8,2) NOT NULL DEFAULT 0,

    CONSTRAINT "teacher_topic_stats_pkey" PRIMARY KEY ("teacher_id","topic_id")
);

-- CreateTable
CREATE TABLE "teacher_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "teacher_id" UUID,
    "file_url" TEXT NOT NULL,
    "doc_type" VARCHAR(40),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "reject_note" TEXT,
    "reviewed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "role" "user_role" NOT NULL,
    "avatar_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "user_id" UUID NOT NULL,
    "grade" SMALLINT,
    "math_level" SMALLINT,
    "school" VARCHAR(120),

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "user_id" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "type" "tx_type" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "session_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "teacher_id" UUID,
    "amount" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "period_start" DATE,
    "period_end" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_question_id_key" ON "sessions"("question_id");

-- CreateIndex
-- HAND-ADDED: WHERE clause. MVP.md §11.2 — only ACTIVE sessions are ever
-- scanned by the block-expiry cron, and they are a tiny fraction of the table.
CREATE INDEX "idx_sessions_active" ON "sessions"("status") WHERE "status" = 'ACTIVE';

-- CreateIndex
-- HAND-ADDED: WHERE clause. MVP.md §11.2 — the offer-expiry cron reads pending
-- offers by expires_at every 10 seconds and nothing else uses this index.
CREATE INDEX "idx_offers_pending" ON "offers"("expires_at") WHERE "status" = 'PENDING';

-- CreateIndex
CREATE UNIQUE INDEX "reviews_session_id_key" ON "reviews"("session_id");

-- CreateIndex
-- HAND-ADDED: WHERE clause. MVP.md §11.2 — this is the index the matching
-- algorithm's hard filter runs on (§9.1). Most teachers are OFFLINE most of the
-- time, so the partial index is a fraction of the size of the full one.
CREATE INDEX "idx_teacher_available" ON "teacher_profiles"("status", "level_max") WHERE "status" = 'ONLINE';

-- CreateIndex
CREATE UNIQUE INDEX "topics_slug_key" ON "topics"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "entrance_questions" ADD CONSTRAINT "entrance_questions_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrance_attempts" ADD CONSTRAINT "entrance_attempts_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_subtopic_id_fkey" FOREIGN KEY ("subtopic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_attachments" ADD CONSTRAINT "question_attachments_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_blocks" ADD CONSTRAINT "session_blocks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_topics" ADD CONSTRAINT "teacher_topics_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_topics" ADD CONSTRAINT "teacher_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_topic_stats" ADD CONSTRAINT "teacher_topic_stats_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_topic_stats" ADD CONSTRAINT "teacher_topic_stats_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_documents" ADD CONSTRAINT "teacher_documents_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_documents" ADD CONSTRAINT "teacher_documents_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint
-- HAND-ADDED. MVP.md §11.2 — `CHECK (balance >= 0)`. The row lock in §11.3-B is
-- what is supposed to stop a concurrent charge from overdrawing a student; this
-- is the database refusing to store the result if that ever fails.
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_non_negative" CHECK ("balance" >= 0);

-- AddCheckConstraint
-- HAND-ADDED. MVP.md §11.2 — `CHECK (stars BETWEEN 1 AND 5)`. Null stays legal:
-- a review can record is_resolved without a star rating.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_stars_range" CHECK ("stars" BETWEEN 1 AND 5);

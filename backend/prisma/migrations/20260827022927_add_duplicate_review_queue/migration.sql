-- CreateEnum
CREATE TYPE "DuplicateReviewStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "duplicate_review_queue_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "office_table" TEXT NOT NULL,
    "candidate_data" JSONB NOT NULL,
    "fuzzy_matches" JSONB NOT NULL,
    "status" "DuplicateReviewStatus" NOT NULL DEFAULT 'pending',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "resolved_person_key" UUID,

    CONSTRAINT "duplicate_review_queue_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "duplicate_review_queue_item_status_idx" ON "duplicate_review_queue_item"("status");

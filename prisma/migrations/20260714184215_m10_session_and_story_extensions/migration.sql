-- CreateEnum
CREATE TYPE "StatusPollKind" AS ENUM ('poll', 'question');

-- AlterEnum
ALTER TYPE "StatusVisibility" ADD VALUE 'close_friends';

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "previous_refresh_token_hash" TEXT,
ADD COLUMN     "refresh_expires_at" TIMESTAMP(3),
ADD COLUMN     "remember_me" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "close_friends" (
    "owner_id" TEXT NOT NULL,
    "friend_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "close_friends_pkey" PRIMARY KEY ("owner_id","friend_id")
);

-- CreateTable
CREATE TABLE "status_reactions" (
    "status_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_reactions_pkey" PRIMARY KEY ("status_id","user_id")
);

-- CreateTable
CREATE TABLE "status_polls" (
    "id" TEXT NOT NULL,
    "status_id" TEXT NOT NULL,
    "kind" "StatusPollKind" NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_poll_responses" (
    "poll_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "selected_option_id" TEXT,
    "answer_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_poll_responses_pkey" PRIMARY KEY ("poll_id","user_id")
);

-- CreateIndex
CREATE INDEX "close_friends_friend_id_idx" ON "close_friends"("friend_id");

-- CreateIndex
CREATE INDEX "status_reactions_user_id_idx" ON "status_reactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "status_polls_status_id_key" ON "status_polls"("status_id");

-- CreateIndex
CREATE INDEX "status_poll_responses_user_id_idx" ON "status_poll_responses"("user_id");

-- CreateIndex
CREATE INDEX "devices_previous_refresh_token_hash_idx" ON "devices"("previous_refresh_token_hash");

-- AddForeignKey
ALTER TABLE "close_friends" ADD CONSTRAINT "close_friends_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_friends" ADD CONSTRAINT "close_friends_friend_id_fkey" FOREIGN KEY ("friend_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_reactions" ADD CONSTRAINT "status_reactions_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_reactions" ADD CONSTRAINT "status_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_polls" ADD CONSTRAINT "status_polls_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_poll_responses" ADD CONSTRAINT "status_poll_responses_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "status_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_poll_responses" ADD CONSTRAINT "status_poll_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

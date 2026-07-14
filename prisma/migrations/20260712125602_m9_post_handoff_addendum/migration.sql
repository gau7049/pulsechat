-- CreateEnum
CREATE TYPE "PostAudience" AS ENUM ('everyone', 'friends', 'only_me');

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "like_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "audience" "PostAudience" NOT NULL DEFAULT 'everyone',
ALTER COLUMN "media_url" DROP NOT NULL;

-- AlterTable
ALTER TABLE "push_subscriptions" ADD COLUMN     "installed_pwa" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "post_tags" (
    "post_id" TEXT NOT NULL,
    "tagged_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_tags_pkey" PRIMARY KEY ("post_id","tagged_user_id")
);

-- CreateTable
CREATE TABLE "comment_likes" (
    "comment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("comment_id","user_id")
);

-- CreateTable
CREATE TABLE "trending_movies" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "poster_url" TEXT,
    "overview" TEXT,
    "rank" INTEGER NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trending_movies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trending_songs" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "cover_url" TEXT,
    "preview_url" TEXT,
    "rank" INTEGER NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trending_songs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_tags_tagged_user_id_idx" ON "post_tags"("tagged_user_id");

-- CreateIndex
CREATE INDEX "comment_likes_user_id_idx" ON "comment_likes"("user_id");

-- CreateIndex
CREATE INDEX "trending_movies_rank_idx" ON "trending_movies"("rank");

-- CreateIndex
CREATE INDEX "trending_songs_rank_idx" ON "trending_songs"("rank");

-- AddForeignKey
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tagged_user_id_fkey" FOREIGN KEY ("tagged_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

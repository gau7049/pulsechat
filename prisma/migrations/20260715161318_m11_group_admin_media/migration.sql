-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "photo_url" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "deleted_by" TEXT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

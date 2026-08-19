-- Hand-edited. Prisma generates a drop-and-add pair for a rename; that is
-- replayed against every database, including ones that by then hold rows E6
-- wrote. Renamed in place instead. See PR-6.0-video-columns-migration.md.

-- AlterTable
ALTER TABLE "sessions" RENAME COLUMN "zoom_join_url"   TO "video_room_url";
ALTER TABLE "sessions" RENAME COLUMN "zoom_meeting_id" TO "video_room_name";
ALTER TABLE "sessions" ALTER COLUMN "video_room_name" TYPE VARCHAR(120);

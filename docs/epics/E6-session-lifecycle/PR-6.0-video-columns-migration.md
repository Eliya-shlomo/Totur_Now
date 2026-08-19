# PR 6.0 — Migration: `zoom_*` → `video_room_name` / `video_room_url`

| | |
|---|---|
| **Epic** | E6 — Session Lifecycle & Video |
| **Owner** | DEV-B (rotem) |
| **Size** | S |
| **Written by** | Agent. The SQL is hand-edited afterwards — see Scope. |
| **Depends on** | E5 (5.1–5.11 merged) |
| **Blocks** | 6.2, and therefore everything after it |
| **Branch** | `dev-b/E6.0-video-columns` |

## Contract implemented

`MVP.md` §11.2, the `sessions` table. Two columns renamed and one widened, so that every
line of code written from 6.3 onward calls the thing it is by its own name.

## Scope

**Two columns, renamed in place.**

| Was | Becomes | Type |
|---|---|---|
| `zoom_join_url` | `video_room_url` | `TEXT` — unchanged |
| `zoom_meeting_id` | `video_room_name` | `VARCHAR(60)` → **`VARCHAR(120)`** |

`video_room_name` is Daily's room identifier and it is what
`createSessionVideoAccess({ roomName })` needs to mint a token; `video_room_url` is what
the client joins. Daily's auto-generated names are short, but a room can be created with a
custom name and the column has no reason to be tight. 120 is the same order as every other
identifier column in the schema.

**The generated SQL must be hand-edited, and this is the whole risk in this PR.** Prisma
does not see a rename — it sees one column dropped and another added, and it generates
exactly that:

```sql
-- what `prisma migrate dev` writes, and what must NOT be committed
ALTER TABLE "sessions" DROP COLUMN "zoom_join_url";
ALTER TABLE "sessions" DROP COLUMN "zoom_meeting_id";
ALTER TABLE "sessions" ADD COLUMN "video_room_url" TEXT;
ALTER TABLE "sessions" ADD COLUMN "video_room_name" VARCHAR(120);
```

Replace it with the rename, by hand, before committing:

```sql
ALTER TABLE "sessions" RENAME COLUMN "zoom_join_url"   TO "video_room_url";
ALTER TABLE "sessions" RENAME COLUMN "zoom_meeting_id" TO "video_room_name";
ALTER TABLE "sessions" ALTER COLUMN "video_room_name" TYPE VARCHAR(120);
```

Both columns are null on every row in every database today, so the drop-and-add would in
fact lose nothing — **and it is still wrong to commit.** Migrations are replayed against
Neon, this one will be replayed after E6 has written rows to these columns on some future
branch, and a migration that is only safe because of a fact about today is a migration that
stops being safe without anybody editing it. Prisma's own documentation says to do this by
hand; do it by hand.

Verify with `npx prisma migrate diff --from-schema-datamodel prisma/schema
--to-schema-datasource prisma/schema --exit-code` after applying, which must report no
drift: the hand-edited SQL and the Prisma models have to agree, and hand-editing is exactly
how they stop agreeing.

**`teacher_profiles.zoom_personal_link` is not touched.** Nothing reads it, nothing in E6
will, and renaming an unread column costs a migration line for zero behaviour — the same
ruling E5 made about `Offer.status` staying a `VarChar(20)`. The epic README records it
under "the column we did not rename" so the next person who greps for "zoom" finds a
decision instead of an oversight.

**The comments in `sessions.prisma` are updated in the same PR.** The model's header
mentions neither column today; the two lines that carry them get a sentence each saying
what they are for and who writes them (6.3), because a column nobody can trace to a writer
is a column somebody adds a second copy of.

## Files you may touch

```
prisma/schema/sessions.prisma                              rename the two fields
prisma/migrations/<timestamp>_video_room_columns/          new, hand-edited SQL
docs/epics/E6-session-lifecycle/README.md                  tick the status box
```

## Files you must NOT touch

```
prisma/schema/teachers.prisma      zoom_personal_link stays
prisma/schema/*.prisma             every other domain file
prisma/migrations/2026*            never edit an existing migration
prisma/seed/**                     nothing seeds these columns
server/**                          nothing reads them yet; 6.2 and 6.3 do
client/**
```

## Acceptance criteria

- [ ] `sessions` has `video_room_url TEXT` and `video_room_name VARCHAR(120)`, and neither `zoom_join_url` nor `zoom_meeting_id`
- [ ] The committed migration SQL contains `RENAME COLUMN` and contains no `DROP COLUMN`
- [ ] `npx prisma migrate diff … --exit-code` reports no drift between the models and the applied database
- [ ] `npx prisma migrate reset` followed by `npm run db:seed` runs clean from zero — the migration replays as well as applies
- [ ] `teacher_profiles.zoom_personal_link` is still there and still unread
- [ ] `grep -ri "zoomJoinUrl\|zoomMeetingId" server client prisma` returns nothing outside comments that explain the rename
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass

## Manual test

1. `npm run db:up && npm run db:migrate`
2. `docker exec tutor_now_db psql -U tutor -d tutor_now -c "\d sessions"` — the two new columns, the two old ones gone
3. `npx prisma migrate reset --force && npm run db:seed` — clean from an empty database
4. Log in as a student and open an existing session. Nothing changed for a user; if anything did, something reads a column it should not have

## Review checklist additions

- Read the committed `.sql` file with your eyes. `DROP COLUMN` in it is the one way this PR fails, and it fails silently on a database where the columns are null.
- Confirm the migration folder name says what it does. `20260819_video_room_columns`, not `20260819_migration`.
- Confirm no second migration is in the same folder. One migration in this epic.

## Notes

**Why the head of the epic and not inside 6.3.** Every server PR from 6.2 on names these
columns — the repository function, the activation service, the video endpoint, the
serializer. A rename landing in the middle means the four PRs before it are written against
one name and the ones after against another, and the diff that renames them is mixed into a
diff that also adds behaviour. It is two hours of work total and it is worth its own commit.

**Why not add new columns and leave the old ones.** Because then the schema has four
columns for two facts, two of them permanently null, and the next person has to read this
document to know which pair is live. The rename is honest and the data loss is zero.

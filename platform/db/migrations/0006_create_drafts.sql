-- The post being written in the composer, saved as it's written so it can be picked up again from
-- any browser (see PostCommands.saveDraft). There's at most one: saving a draft replaces any other.
-- `id` is the post's id, which its uploaded files are kept under, and `data` the composer's values
-- as JSON (ComposeValues in src/domain/compose.ts).
create table drafts (
  id text primary key not null,
  data text not null,
  updated_at text not null
);

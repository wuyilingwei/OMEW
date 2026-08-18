-- Global index of stronghold membership. D1 has no view into per-StrongholdDO
-- storage, so this table exists purely so GET /api/me/strongholds can enumerate
-- an actor's strongholds without fanning out to every DO in the account.
-- Best-effort side index, kept in sync by StrongholdDO on every membership
-- change - the `member` table inside each StrongholdDO stays the sole authority
-- for actual membership state.
CREATE TABLE stronghold_member_index (
  actor TEXT NOT NULL,
  stronghold_id TEXT NOT NULL,
  PRIMARY KEY (actor, stronghold_id)
);

CREATE INDEX idx_stronghold_member_index_actor ON stronghold_member_index(actor);

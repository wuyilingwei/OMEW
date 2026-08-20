-- Task 033: INSTANCE_DOMAIN wrangler var replaces the M1 "local" actor-domain
-- placeholder. D1 columns that stored a local actor's full `@localpart:domain`
-- string are rewritten here. `users.localpart` stores no domain (actor strings
-- are built at read time) so it needs no migration. guest_identity/
-- guest_member_state only ever hold actors from foreign domains and are
-- unaffected. DO-internal storage (RoomDO item.actor/tombstone.actor,
-- StrongholdDO member/config/ban actors) is a separate SQLite store per DO, has
-- no migration mechanism here, and is intentionally left as-is: m0-protocol §9
-- treats already-written content as immutable, so historical rows keep showing
-- ":local" as a trace of when they were written. Existing session tokens carry
-- their actor in signed claims and simply expire/stop matching naturally - no
-- action needed for those either.
--
-- instance_config.stronghold_creators is deliberately NOT rewritten here: it's a
-- JSON-encoded array (admin-entered via PATCH /api/admin/instance/config, not
-- system-populated), so a blind substring REPLACE risks corrupting an
-- already-foreign actor whose domain happens to start with "local" (e.g.
-- "@x:localsomething.example"). It's empty by default and rarely populated
-- (stronghold_creation_policy must be "restricted" for it to matter); an admin
-- who configured it with pre-migration local actors can just re-PATCH it.

UPDATE stronghold_member_index SET actor = REPLACE(actor, ':local', ':omew.wuyilingwei.com') WHERE actor LIKE '%:local';
UPDATE media SET owner_actor = REPLACE(owner_actor, ':local', ':omew.wuyilingwei.com') WHERE owner_actor LIKE '%:local';
UPDATE emote_packs SET created_by = REPLACE(created_by, ':local', ':omew.wuyilingwei.com') WHERE created_by LIKE '%:local';
UPDATE invite_codes SET created_by = REPLACE(created_by, ':local', ':omew.wuyilingwei.com') WHERE created_by LIKE '%:local';
UPDATE stronghold_applications SET actor = REPLACE(actor, ':local', ':omew.wuyilingwei.com') WHERE actor LIKE '%:local';
UPDATE stronghold_applications SET decided_by = REPLACE(decided_by, ':local', ':omew.wuyilingwei.com') WHERE decided_by LIKE '%:local';

-- Task 034: guest read-only browsing policy toggle, default on.
ALTER TABLE instance_config ADD COLUMN allow_guest_browsing INTEGER NOT NULL DEFAULT 1;

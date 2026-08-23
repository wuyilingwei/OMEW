-- Ordinary user blocks and private messages. These are intentionally separate
-- from account/stronghold moderation bans: a block only prevents new DMs.
CREATE TABLE user_blocks (
  blocker_actor TEXT NOT NULL,
  blocked_actor TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_actor, blocked_actor),
  CHECK (blocker_actor <> blocked_actor)
);

CREATE TABLE direct_messages (
  id TEXT PRIMARY KEY,
  stronghold_id TEXT NOT NULL,
  sender_actor TEXT NOT NULL,
  recipient_actor TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (sender_actor <> recipient_actor)
);

CREATE INDEX idx_direct_messages_thread
  ON direct_messages (stronghold_id, sender_actor, recipient_actor, created_at);

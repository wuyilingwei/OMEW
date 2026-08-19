// actor strings look like "@name:domain" (m0-protocol). Chat/post items only
// carry the raw actor, not a display name, so callers resolve a friendly
// label via the already-loaded stronghold member roster and fall back to
// the actor's localpart when the roster doesn't have it yet (e.g. a guest).
export function actorLocalpart(actor: string): string {
  return actor.replace(/^@/, '').split(':')[0] ?? actor
}

// Mirror of server/src/reserved-usernames.ts (authoritative there) so the
// register form can reject an official-looking name before a round trip.
// test/reserved-usernames.test.ts pins the two lists to each other.

export const RESERVED_USERNAMES: readonly string[] = [
  // authority and official identity
  'admin',
  'admins',
  'administrator',
  'root',
  'superuser',
  'sysadmin',
  'system',
  'owner',
  'moderator',
  'moderators',
  'mod',
  'mods',
  'staff',
  'official',
  'team',

  // service and automated senders
  'bot',
  'bots',
  'daemon',
  'service',
  'support',
  'help',
  'helpdesk',
  'contact',
  'security',
  'abuse',
  'postmaster',
  'webmaster',
  'hostmaster',
  'noreply',
  'donotreply',
  'notification',
  'notifications',
  'alert',
  'alerts',

  // brand
  'omew',
  'openmew',
  'mew',

  // route prefixes and protocol identifiers
  'api',
  'www',
  'media',
  'assets',
  'static',
  'inbox',
  'wellknown',
  'oauth',
  'auth',
  'login',
  'logout',
  'register',
  'signup',
  'signin',
  'settings',
  'me',
  'user',
  'users',
  'account',
  'accounts',
  'directory',

  // broadcast mentions and placeholder semantics
  'everyone',
  'here',
  'all',
  'channel',
  'guest',
  'anonymous',
  'deleted',
  'unknown',
  'null',
  'undefined',
]

function stripSeparators(username: string): string {
  return username.replace(/[-_]/g, '')
}

const RESERVED_SET = new Set(RESERVED_USERNAMES.map(stripSeparators))

export function isReservedUsername(username: string): boolean {
  return RESERVED_SET.has(stripSeparators(username))
}

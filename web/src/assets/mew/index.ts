// central re-export of the bundled Mew illustration subset - see NOTICE.md
// for licensing. Vite resolves these imports to hashed build URLs.
import azUrl from './az.webp'
import comfortUrl from './comfort.webp'
import defaultAvatar0Url from './default-avatar-0.png'
import defaultAvatar1Url from './default-avatar-1.png'
import defaultNodePageBgUrl from './default-node-page-bg.png'
import helpfulUrl from './helpful.webp'
import kusaUrl from './kusa.webp'
import lanceUrl from './lance.webp'
import likeUrl from './like.webp'
import mAliceUrl from './m-alice.webp'
import mAngryUrl from './m-angry.webp'
import mSadUrl from './m-sad.webp'
import mSuccessUrl from './m-success.webp'
import mWarningUrl from './m-warning.webp'
import memberSearchUrl from './member-search.webp'
import niubiUrl from './niubi.webp'
import noMsgUrl from './no-msg.webp'
import noThoughtUrl from './no-thought.webp'
import okashiiUrl from './okashii.webp'
import questionUrl from './question.webp'
import saluteUrl from './salute.webp'
import tearUrl from './tear.webp'
import uhhuhUrl from './uhhuh.webp'
import wAliceUrl from './w-alice.webp'
import wDoNotUrl from './w-do-not.webp'
import wEllipsisUrl from './w-ellipsis.webp'
import wErrorUrl from './w-error.webp'
import wLetMeSeeUrl from './w-let-me-see.webp'

export const DEFAULT_AVATARS = [defaultAvatar0Url, defaultAvatar1Url]
export const DEFAULT_NODE_PAGE_BG = defaultNodePageBgUrl

export const EMPTY_STATE = {
  chat: noMsgUrl,
  posts: noThoughtUrl,
  members: memberSearchUrl,
  onboarding: azUrl,
}

// name -> url, keyed the same way the seed script names emotes (filename minus extension)
export const MASCOT_EMOTES: Record<string, string> = {
  az: azUrl,
  comfort: comfortUrl,
  helpful: helpfulUrl,
  kusa: kusaUrl,
  lance: lanceUrl,
  like: likeUrl,
  'm-alice': mAliceUrl,
  'm-angry': mAngryUrl,
  'm-sad': mSadUrl,
  'm-success': mSuccessUrl,
  'm-warning': mWarningUrl,
  niubi: niubiUrl,
  okashii: okashiiUrl,
  question: questionUrl,
  salute: saluteUrl,
  tear: tearUrl,
  uhhuh: uhhuhUrl,
  'w-alice': wAliceUrl,
  'w-do-not': wDoNotUrl,
  'w-ellipsis': wEllipsisUrl,
  'w-error': wErrorUrl,
  'w-let-me-see': wLetMeSeeUrl,
}

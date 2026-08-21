// central re-export of the bundled Mew asset subset - see NOTICE.md for
// licensing. Vite resolves these imports to hashed build URLs.
import azUrl from './az.webp'
import comfortUrl from './comfort.webp'
import defaultAvatar0Url from './default-avatar-0.png'
import defaultAvatar1Url from './default-avatar-1.png'
import defaultNodePageBgUrl from './default-node-page-bg.png'
import helpfulUrl from './helpful.webp'
import kusaUrl from './kusa.webp'
import lanceUrl from './lance.webp'
import likeUrl from './like.webp'
import memberSearchUrl from './member-search.webp'
import niubiUrl from './niubi.webp'
import noMsgUrl from './no-msg.webp'
import noThoughtUrl from './no-thought.webp'
import okashiiUrl from './okashii.webp'
import questionUrl from './question.webp'
import saluteUrl from './salute.webp'
import stampAzUrl from './stamp-az.webp'
import stampComfortUrl from './stamp-comfort.webp'
import stampHelpfulUrl from './stamp-helpful.webp'
import stampKusaUrl from './stamp-kusa.webp'
import stampLanceUrl from './stamp-lance.webp'
import stampLikeUrl from './stamp-like.webp'
import stampNiubiUrl from './stamp-niubi.webp'
import stampOkashiiUrl from './stamp-okashii.webp'
import stampQuestionUrl from './stamp-question.webp'
import stampSaluteUrl from './stamp-salute.webp'
import stampTearUrl from './stamp-tear.webp'
import stampUhhuhUrl from './stamp-uhhuh.webp'
import tearUrl from './tear.webp'
import uhhuhUrl from './uhhuh.webp'

export const DEFAULT_AVATARS = [defaultAvatar0Url, defaultAvatar1Url]
export const DEFAULT_NODE_PAGE_BG = defaultNodePageBgUrl

export const EMPTY_STATE = {
  chat: noMsgUrl,
  posts: noThoughtUrl,
  members: memberSearchUrl,
  onboarding: azUrl,
}

// the forum's standard sticker set (4x3) - full-bleed pictures sent as their
// own card in chat. Drives the built-in pack, see mew-emotes.ts. Same twelve
// semantic names as REACTION_SET below but a completely different set of
// pictures, hence the stamp- prefix on the files.
export const STAMP_EMOTES: Record<string, string> = {
  az: stampAzUrl,
  comfort: stampComfortUrl,
  helpful: stampHelpfulUrl,
  kusa: stampKusaUrl,
  lance: stampLanceUrl,
  like: stampLikeUrl,
  niubi: stampNiubiUrl,
  okashii: stampOkashiiUrl,
  question: stampQuestionUrl,
  salute: stampSaluteUrl,
  tear: stampTearUrl,
  uhhuh: stampUhhuhUrl,
}

// flat thick-outline glyphs - small reactions meant to attach to a message or
// post rather than be sent as their own card.
export const REACTION_SET: Record<string, string> = {
  az: azUrl,
  comfort: comfortUrl,
  helpful: helpfulUrl,
  kusa: kusaUrl,
  lance: lanceUrl,
  like: likeUrl,
  niubi: niubiUrl,
  okashii: okashiiUrl,
  question: questionUrl,
  salute: saluteUrl,
  tear: tearUrl,
  uhhuh: uhhuhUrl,
}

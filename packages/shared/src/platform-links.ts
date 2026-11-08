import { discourseItemId, type Forum } from './forums'
import { placeLabel, type Platform, type PlatformPlace } from './platforms'

/** What a link names on its platform: the most specific id (a Reddit comment's, not its post's), and who or where it names. */
interface LinkRead {
  externalId: string
  author: string | null
  community: string | null
}

/** Where a link ends: a further path, a query or a fragment may follow the id. */
const END = String.raw`(?:[/?#]|$)`

/** One reader per platform for every link: to a thread the operator pastes and to what they posted alike. A forum's are `forumLink`'s. */
const LINKS: Record<Exclude<Platform, 'forum'>, (url: string) => LinkRead | null> = {
  x: (url) => {
    const match = new RegExp(String.raw`^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/(\d+)${END}`).exec(url)
    return match?.[1] && match[2] ? { externalId: match[2], author: match[1], community: null } : null
  },
  linkedin: (url) => {
    const update = /^https?:\/\/(?:www\.)?linkedin\.com\/feed\/update\/urn:li:(activity|share|ugcPost):(\d+)/.exec(url)
    if (update?.[1] && update[2]) return { externalId: `urn:li:${update[1]}:${update[2]}`, author: null, community: null }
    const post = /^https?:\/\/(?:www\.)?linkedin\.com\/posts\/([^_/]+)_[^/]*-(activity|share|ugcPost)-(\d+)/.exec(url)
    return post?.[1] && post[2] && post[3] ? { externalId: `urn:li:${post[2]}:${post[3]}`, author: post[1], community: null } : null
  },
  // A comment's link names its post, a slug (or "comment") and the comment: the comment is what a reply answers or what was posted.
  reddit: (url) => {
    const match = new RegExp(
      String.raw`^https?://(?:www\.|old\.)?reddit\.com/r/([A-Za-z0-9_]+)/comments/([a-z0-9]+)(?:/[^/?#]*/([a-z0-9]+))?${END}`
    ).exec(url)
    if (!match?.[1] || !match[2]) return null
    return { externalId: match[3] ? `t1_${match[3]}` : `t3_${match[2]}`, author: null, community: match[1] }
  },
  hackernews: (url) => {
    const match = /^https?:\/\/news\.ycombinator\.com\/item\?id=(\d+)/.exec(url)
    return match?.[1] ? { externalId: match[1], author: null, community: 'Hacker News' } : null
  },
}

/**
 * A link on the account's forum: on Discourse a topic (`/t/<slug>/<id>`) or
 * a post in it (`/t/<slug>/<id>/<number>`), the topic's first post being the
 * topic (shared `discourseItemId`); on other software, which is read by
 * hand, the page itself, by its path, query and fragment, which may name
 * one post of a thread.
 */
function forumLink(forum: Forum, url: string): LinkRead | null {
  let page: URL
  try {
    page = new URL(url)
  } catch {
    return null
  }
  if (page.origin !== forum.origin) return null
  if (forum.software === 'other') {
    const path = page.pathname.replace(/\/+$/, '')
    return path === '' ? null : { externalId: `${path}${page.search}${page.hash}`, author: null, community: null }
  }
  // A slug has a letter in it, so in /t/296315/4 the first number is the topic and the second the post.
  const match = new RegExp(String.raw`^/t/(?:[^/]*[^/\d][^/]*/)?(\d+)(?:/(\d+))?${END}`).exec(`${page.pathname}${page.search}`)
  if (!match?.[1]) return null
  return { externalId: discourseItemId(Number(match[1]), match[2] === undefined ? 1 : Number(match[2])), author: null, community: null }
}

function readLink(place: PlatformPlace, url: string): LinkRead | null {
  return place.platform === 'forum' ? forumLink(place.forum, url) : LINKS[place.platform](url)
}

/** A link to a thread the operator pasted, as its platform writes it: the id a reply answers, and who or where it names. */
export type ThreadLink = ({ kind: 'link'; url: string } & LinkRead) | { kind: 'invalid'; problem: string }

/** The thread a pasted link names where the account takes part, or why it names none. */
export function parseThreadLink(place: PlatformPlace, url: string): ThreadLink {
  const link = url.trim()
  const read = readLink(place, link)
  if (read === null) return { kind: 'invalid', problem: `That is no link to a thread on ${placeLabel(place)}.` }
  return { kind: 'link', url: link, ...read }
}

/**
 * The link the operator gives for what they posted: none, one to their post
 * or reply on the account's platform with the id the analyst reads its
 * numbers by, or one the backend refuses and the studio flags as it is typed.
 */
export type PostedLink = { kind: 'none' } | { kind: 'link'; url: string; externalId: string } | { kind: 'invalid'; problem: string }

export function parsePostedLink(place: PlatformPlace, url: string | undefined): PostedLink {
  const link = url?.trim()
  if (!link) return { kind: 'none' }
  const read = readLink(place, link)
  if (read === null) return { kind: 'invalid', problem: `That is no link to your post or reply on ${placeLabel(place)}.` }
  return { kind: 'link', url: link, externalId: read.externalId }
}

/** Where the operator edits a profile on each platform; a forum's is `forumProfileEditLink`'s. */
const PROFILE_EDIT_LINKS: Record<Exclude<Platform, 'forum'>, (handle: string) => string> = {
  x: () => 'https://x.com/settings/profile',
  reddit: () => 'https://www.reddit.com/settings/profile',
  // Hacker News edits the "about" on the user's own page, signed in.
  hackernews: (handle) => `https://news.ycombinator.com/user?id=${encodeURIComponent(handle)}`,
  linkedin: (handle) => `https://www.linkedin.com/in/${encodeURIComponent(handle)}/`,
}

/** On Discourse the profile's "About me" is a preference; other software's page is not known. */
function forumProfileEditLink(forum: Forum, handle: string): string | null {
  return forum.software === 'discourse' ? `${forum.origin}/u/${encodeURIComponent(handle)}/preferences/profile` : null
}

/** Where the operator edits the account's profile, where its bio goes; null where Influstep does not know the page. */
export function profileEditLink(place: PlatformPlace, handle: string): string | null {
  return place.platform === 'forum' ? forumProfileEditLink(place.forum, handle) : PROFILE_EDIT_LINKS[place.platform](handle)
}

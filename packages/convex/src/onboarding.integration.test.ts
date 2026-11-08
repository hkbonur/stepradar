import { DEFAULT_FORMATS, type AccountIdentity, type AccountProposal } from '@influstep/shared'
import type { FunctionArgs } from 'convex/server'
import { ConvexError } from 'convex/values'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import { addDays, dayKey, weekStart } from './core/dates'
import { noReadableCommunity } from './core/planner'
import { setup } from '../test/setup'

const TIMEZONE = 'Europe/Oslo'

/** The operator's own X account, as the setup names it. */
const NORA: AccountIdentity = {
  platform: 'x',
  handle: 'nora_notion',
  name: 'Nora',
  niche: 'Notion for freelancers',
  audience: 'freelance designers',
}

type Test = ReturnType<typeof setup>
type CreateArgs = FunctionArgs<typeof api.private.onboarding.create>

const PRODUCT = {
  sponsorName: 'Ledgerly',
  sponsorUrl: 'https://app.ledgerly.example',
  sponsorPitch: 'Bookkeeping that categorises every receipt for you.',
  valuePerPaid: 49,
  currency: 'USD',
  appUrl: 'http://localhost:3300/',
}

function createArgs(identity: AccountIdentity, proposal: AccountProposal): CreateArgs {
  return { ...identity, ...proposal, ...DEFAULT_FORMATS[identity.platform], sponsorDial: 0.3, timezone: TIMEZONE }
}

/** A backend past the first-run setup: the product is named, no account yet. */
async function withProduct(): Promise<Test> {
  const t = setup()
  await t.mutation(api.private.workspace.create, PRODUCT)
  return t
}

async function roster(t: Test) {
  const start = await t.query(api.private.onboarding.start, {})
  if (start === null) throw new Error('no workspace')
  return start.roster
}

async function proposeAndCreate(t: Test, identity: AccountIdentity) {
  const proposal = await t.action(api.private.onboarding.propose, identity)
  const accountId = await t.mutation(api.private.onboarding.create, createArgs(identity, proposal))
  return { proposal, accountId }
}

describe('first-run setup', () => {
  it('has no workspace until the operator names the product, then keeps it with the studio origin for links', async () => {
    const t = setup()
    expect(await t.query(api.private.workspace.get, {})).toBeNull()
    expect(await t.query(api.private.onboarding.start, {})).toBeNull()
    await expect(t.action(api.private.onboarding.propose, NORA)).rejects.toThrow('Set up your product first')

    await t.mutation(api.private.workspace.create, PRODUCT)
    expect(await t.query(api.private.workspace.get, {})).toMatchObject({
      name: 'Ledgerly',
      sponsorName: 'Ledgerly',
      sponsorPitch: 'Bookkeeping that categorises every receipt for you.',
      appUrl: 'http://localhost:3300',
      valuePerPaid: 49,
      currency: 'USD',
    })
    expect(await roster(t)).toEqual([])
    await expect(t.mutation(api.private.workspace.create, PRODUCT)).rejects.toThrow('Your product is already set up.')
  })

  it('refuses a product without a name, a website or a pitch, with the words the studio shows', async () => {
    const t = setup()
    await expect(t.mutation(api.private.workspace.create, { ...PRODUCT, sponsorName: ' ' })).rejects.toThrow('Name the product.')
    await expect(t.mutation(api.private.workspace.create, { ...PRODUCT, sponsorUrl: 'ledgerly' })).rejects.toThrow(
      'The website must be a full address'
    )
    await expect(t.mutation(api.private.workspace.create, { ...PRODUCT, sponsorPitch: 'Books.' })).rejects.toThrow(
      'Say what the product does'
    )
    expect(await t.query(api.private.workspace.get, {})).toBeNull()
  })

  it('changes the product in place', async () => {
    const t = await withProduct()
    await t.mutation(api.private.workspace.update, { ...PRODUCT, sponsorUrl: 'https://ledgerly.example/app', valuePerPaid: 59 })
    expect(await t.query(api.private.workspace.get, {})).toMatchObject({ sponsorUrl: 'https://ledgerly.example/app', valuePerPaid: 59 })
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('onboarding', () => {
  it('builds an account once the product is set up and plans its first two weeks of posts', async () => {
    const t = await withProduct()
    expect(await roster(t)).toEqual([])

    const { proposal, accountId } = await proposeAndCreate(t, NORA)
    // The writer proposes how the account sounds; the operator named it.
    expect(proposal.pillars).toHaveLength(3)
    expect(proposal.bible).toContain('Nora talks to freelance designers')

    await t.finishAllScheduledFunctions(() => {})
    const page = await t.query(api.private.accounts.get, { accountId })
    expect(page?.account).toMatchObject({
      name: 'Nora',
      handle: 'nora_notion',
      audience: 'freelance designers',
      sponsorRampPosts: 10,
      ...DEFAULT_FORMATS.x,
    })
    // This week's remaining days and next week's.
    const today = dayKey(Date.now(), TIMEZONE)
    const nextWeekEnd = addDays(weekStart(today), 13)
    const posts = page?.posts ?? []
    expect(posts.length).toBeGreaterThanOrEqual(3)
    expect(posts.every((post) => post.plannedFor >= today && post.plannedFor <= nextWeekEnd)).toBe(true)
    expect(posts.some((post) => post.plannedFor > addDays(weekStart(today), 6))).toBe(true)
  })

  it('adds an account on another platform, its handle there the same, and refuses a handle taken on its platform or that it does not allow', async () => {
    const t = await withProduct()
    await proposeAndCreate(t, NORA)
    // On X a handle has no case, so Nora_Notion is the account the roster has.
    await expect(t.action(api.private.onboarding.propose, { ...NORA, handle: 'Nora_Notion' })).rejects.toThrow(
      'The X handle Nora_Notion is taken.'
    )
    const hackerNews: AccountIdentity = { ...NORA, platform: 'hackernews', handle: 'Nora_Notion' }
    const proposal = await t.action(api.private.onboarding.propose, hackerNews)
    await expect(t.mutation(api.private.onboarding.create, createArgs({ ...NORA, handle: 'NORA_NOTION' }, proposal))).rejects.toThrow(
      'The X handle NORA_NOTION is taken.'
    )
    await expect(t.action(api.private.onboarding.propose, { ...NORA, handle: 'nora.notion' })).rejects.toThrow(
      'X handles are 1 to 15 letters, digits or underscores.'
    )

    // The same handle on Hacker News is another account, and Hacker News reads a username as it is spelled, so it keeps its case.
    const accountId = await t.mutation(api.private.onboarding.create, createArgs(hackerNews, proposal))
    const page = await t.query(api.private.accounts.get, { accountId })
    expect(page?.account).toMatchObject({ handle: 'Nora_Notion', ...DEFAULT_FORMATS.hackernews })
    expect((await roster(t)).map((account) => [account.platform, account.handle])).toEqual([
      ['x', 'nora_notion'],
      ['hackernews', 'Nora_Notion'],
    ])
  })

  it('finds the forum at the address the operator gives, and takes a username once per forum', async () => {
    const t = await withProduct()
    // In mock mode every forum is a Discourse forum named by its host.
    const forum = await t.action(api.private.onboarding.checkForum, { address: 'https://community.n8n.io/t/webhook-retries/296315' })
    expect(forum).toEqual({ origin: 'https://community.n8n.io', name: 'community.n8n.io', software: 'discourse' })
    await expect(t.action(api.private.onboarding.checkForum, { address: 'http://community.n8n.io' })).rejects.toThrow(
      'Influstep reads a forum over https only.'
    )
    const onN8n: AccountIdentity = { ...NORA, platform: 'forum', forum, handle: 'Nora Notes' }
    await proposeAndCreate(t, onN8n)
    await expect(t.action(api.private.onboarding.propose, { ...onN8n, handle: 'nora notes' })).rejects.toThrow(
      'The community.n8n.io handle nora notes is taken.'
    )
    // The same username on another forum is another account.
    const zapier = { origin: 'https://community.zapier.com', name: 'Zapier Community', software: 'other' as const }
    await proposeAndCreate(t, { ...onN8n, forum: zapier })
    expect(
      (await roster(t)).map((account) => [account.platform, account.handle, 'forum' in account ? account.forum.origin : null])
    ).toEqual([
      ['forum', 'Nora Notes', 'https://community.n8n.io'],
      ['forum', 'Nora Notes', 'https://community.zapier.com'],
    ])
    // A forum account names its forum, and no other account has one.
    await expect(t.action(api.private.onboarding.propose, { ...NORA, platform: 'forum' })).rejects.toThrow(
      'Give the forum’s address, and Influstep finds the forum there.'
    )
    await expect(t.action(api.private.onboarding.propose, { ...NORA, forum })).rejects.toThrow('a x account has a forum')
  })

  it("opens a new account's first checklist items: its bio for its profile, and its voice where its posts can come in, done once learned", async () => {
    const t = await withProduct()
    const { proposal, accountId } = await proposeAndCreate(t, NORA)
    const openItems = async () =>
      (await t.query(api.private.checklist.list, {}))
        .filter((item) => item.accountId === accountId && item.status === 'open')
        .map(({ title, why, action }) => ({ title, why, action }))
    expect(await openItems()).toEqual([
      {
        title: "Put the bio and its link on @nora_notion's profile",
        why: expect.stringMatching(
          new RegExp(
            `^People who read a reply or a post open the profile next\\. Its bio: "${proposal.bio}" Its link, so the signups the profile brings count for the account: http://localhost:3300/go/[a-z0-9]+$`
          )
        ),
        action: { kind: 'visit', url: 'https://x.com/settings/profile' },
      },
      {
        title: "Teach the writer @nora_notion's voice",
        why: "Until the analyst learns it from at least 10 of the account's own posts, the writer writes in English in the account's tone. Bring its posts in on the voice page, then learn the voice.",
        action: { kind: 'learn_voice' },
      },
    ])
    await t.finishAllScheduledFunctions(() => {})
    await t.mutation(api.private.history.importHistory, { accountId })
    await t.finishAllScheduledFunctions(() => {})
    await t.mutation(api.private.history.learnVoice, { accountId })
    await t.finishAllScheduledFunctions(() => {})
    expect((await openItems()).map((item) => item.title)).toEqual(["Put the bio and its link on @nora_notion's profile"])
    // Clear history takes the voice with the posts, so the checklist asks for it again.
    await t.mutation(api.private.history.clearHistory, { accountId })
    await t.finishAllScheduledFunctions(() => {})
    expect((await openItems()).map((item) => item.title)).toEqual([
      "Teach the writer @nora_notion's voice",
      "Put the bio and its link on @nora_notion's profile",
    ])

    // A forum Influstep cannot read: its posts never come in, and its profile page is not known.
    const zapier = { origin: 'https://community.zapier.com', name: 'Zapier Community', software: 'other' as const }
    const onZapier = await proposeAndCreate(t, { ...NORA, platform: 'forum', forum: zapier, handle: 'Nora Notes' })
    const zapierItems = (await t.query(api.private.checklist.list, {})).filter((item) => item.accountId === onZapier.accountId)
    expect(zapierItems.map(({ title, action }) => ({ title, action }))).toEqual([
      { title: "Put the bio and its link on @Nora Notes's profile", action: undefined },
    ])
    // Nor are its categories read, so it plans no post, ever, and says so.
    expect(await t.query(api.private.accounts.get, { accountId: onZapier.accountId })).toMatchObject({
      posts: [],
      planWaits: noReadableCommunity('Zapier Community'),
    })
  })

  it('says which key is missing in real mode before the writer proposes, in words the studio shows', async () => {
    const t = await withProduct()
    vi.stubEnv('PROVIDERS_MODE', 'real')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const proposing = t.action(api.private.onboarding.propose, NORA)
    await expect(proposing).rejects.toBeInstanceOf(ConvexError)
    await expect(proposing).rejects.toThrow(
      'ANTHROPIC_API_KEY is not set on this deployment. The Providers page lists the keys each provider needs.'
    )
  })

  it('refuses a proposal without a niche or with too few pillars', async () => {
    const t = await withProduct()
    await expect(t.action(api.private.onboarding.propose, { ...NORA, niche: ' ' })).rejects.toThrow(
      'Say what the account is about: its niche.'
    )
    const proposal = await t.action(api.private.onboarding.propose, NORA)
    const base = createArgs(NORA, proposal)
    await expect(t.mutation(api.private.onboarding.create, { ...base, pillars: ['Formulas'] })).rejects.toThrow(
      'Give 3 to 5 content pillars, comma separated.'
    )
    await expect(t.mutation(api.private.onboarding.create, { ...base, sponsorDial: 2 })).rejects.toThrow(
      'The sponsor dial is between 0 and 1.'
    )
    expect(await roster(t)).toEqual([])
  })
})

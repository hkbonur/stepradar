import { describe, expect, it } from 'vitest'
import { identityProblems, parsePillars, proposalProblems, takenHandleProblem } from './onboarding'

const IDENTITY = {
  platform: 'x' as const,
  handle: 'nora_notes',
  name: 'Nora',
  niche: 'Notion for freelancers',
  audience: 'freelance designers',
}

const PROPOSAL = {
  tone: 'warm and direct',
  pillars: ['Client portals', 'Templates', 'Invoicing'],
  bio: 'One Notion setup a day.',
  bible: 'Nora shows before she tells.',
  affiliationLine: "I'm building Formstep, so take this with salt.",
}

describe('parsePillars', () => {
  it('splits on commas and drops empty ones', () => {
    expect(parsePillars(' a, b ,, c ')).toEqual(['a', 'b', 'c'])
  })
})

describe('identityProblems', () => {
  it('has none for an account its platform would know', () => {
    expect(identityProblems(IDENTITY)).toEqual([])
    expect(identityProblems({ ...IDENTITY, platform: 'hackernews', handle: 'Nora' })).toEqual([])
    expect(takenHandleProblem(IDENTITY, [{ platform: 'x', handle: 'ada_automates' }])).toBeNull()
    // The same handle on another platform is another account.
    expect(takenHandleProblem(IDENTITY, [{ platform: 'reddit', handle: 'nora_notes' }])).toBeNull()
  })

  it("names a taken handle, in any case, or one its platform does not allow, in the platform's own rule", () => {
    expect(takenHandleProblem(IDENTITY, [{ platform: 'x', handle: 'Nora_Notes' }])).toBe('The X handle nora_notes is taken.')
    expect(identityProblems({ ...IDENTITY, handle: 'nora.notes' })).toEqual(['X handles are 1 to 15 letters, digits or underscores.'])
    expect(identityProblems({ ...IDENTITY, platform: 'reddit', handle: 'no' })).toEqual([
      'Reddit handles are 3 to 20 letters, digits, dashes or underscores.',
    ])
  })

  it('takes a handle once per forum: the same username on two forums is two accounts', () => {
    const n8n = {
      platform: 'forum' as const,
      forum: { origin: 'https://community.n8n.io', name: 'n8n Community', software: 'discourse' as const },
    }
    const zapier = {
      platform: 'forum' as const,
      forum: { origin: 'https://community.zapier.com', name: 'Zapier Community', software: 'other' as const },
    }
    const forumAccount = { ...IDENTITY, ...n8n, handle: 'Nora Notes' }
    expect(identityProblems(forumAccount)).toEqual([])
    expect(takenHandleProblem(forumAccount, [{ ...zapier, handle: 'nora notes' }])).toBeNull()
    expect(takenHandleProblem(forumAccount, [{ ...n8n, handle: 'nora notes' }])).toBe('The n8n Community handle Nora Notes is taken.')
    expect(identityProblems({ ...forumAccount, handle: '@nora' })).toEqual(['Forum handles are 2 to 60 characters, with no @ or slash.'])
  })

  it('asks for the name, the niche and the audience', () => {
    expect(identityProblems({ ...IDENTITY, name: ' ', niche: '', audience: '' })).toHaveLength(3)
  })
})

describe('proposalProblems', () => {
  it('has none for a full proposal', () => {
    expect(proposalProblems(PROPOSAL, 'Formstep')).toEqual([])
  })

  it('names a pillar count out of bounds and a pillar named twice', () => {
    expect(proposalProblems({ ...PROPOSAL, pillars: ['a', 'b'] }, 'Formstep')).toEqual(['Give 3 to 5 content pillars, comma separated.'])
    expect(proposalProblems({ ...PROPOSAL, pillars: ['a', 'B', 'b'] }, 'Formstep')).toEqual(['Each content pillar is named once.'])
  })

  it('asks for every empty field', () => {
    expect(
      proposalProblems({ tone: '', pillars: ['a', 'b', 'c'], bio: '', bible: '', affiliationLine: 'I build it.' }, 'Formstep')
    ).toHaveLength(4)
  })
})

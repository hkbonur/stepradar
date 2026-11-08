import { describe, expect, it } from 'vitest'
import { disclosureProblems, mayNameSponsor, postDisclosureProblems, type DisclosureContext } from './disclosure'

const LINE = "I'm building Formstep, so take this with salt."

const CONTEXT: DisclosureContext = {
  platform: 'reddit',
  sponsorName: 'Formstep',
  affiliationLine: LINE,
  community: { name: 'n8n', selfPromotion: 'allowed' },
  week: { posted: 19, named: 1 },
  sponsorDial: 0.1,
  operatorAsked: false,
  sponsorMention: 'mention',
}

describe('the ground rules on a reply draft', () => {
  it('lets a reply that names nobody through, and one that names the sponsor with the affiliation line where it may', () => {
    expect(disclosureProblems('Cap the retries.', CONTEXT)).toEqual([])
    expect(disclosureProblems(`${LINE} Formstep does that.`, CONTEXT)).toEqual([])
    expect(mayNameSponsor(CONTEXT)).toBe(true)
  })

  it('asks for the affiliation line as written whenever the sponsor is named (rule 1)', () => {
    expect(disclosureProblems('Formstep does that.', CONTEXT)).toEqual([`A reply that names Formstep says "${LINE}" as written.`])
  })

  it('keeps the sponsor out of a community that forbids self-promotion, even when the operator asked (rule 3)', () => {
    const forbidden = { ...CONTEXT, community: { name: 'n8n', selfPromotion: 'forbidden' as const }, operatorAsked: true }
    expect(disclosureProblems(`${LINE} Formstep does that.`, forbidden)).toEqual(['Leave Formstep out: r/n8n says no self-promotion.'])
    expect(mayNameSponsor(forbidden)).toBe(false)
  })

  it("caps the week's share of replies naming the sponsor at the dial, unless the operator asked (rule 4)", () => {
    const full = { ...CONTEXT, week: { posted: 9, named: 1 } }
    expect(disclosureProblems(`${LINE} Formstep does that.`, full)).toEqual([
      'Leave Formstep out: 1 of the 9 replies this week, posted or waiting for you, named it, and the dial allows 10%.',
    ])
    expect(mayNameSponsor(full)).toBe(false)
    expect(disclosureProblems(`${LINE} Formstep does that.`, { ...full, operatorAsked: true })).toEqual([])
  })

  it('holds a Hacker News draft to at most three talking points (rule 6)', () => {
    const hn = { ...CONTEXT, platform: 'hackernews' as const, community: null }
    expect(disclosureProblems('- Retries run twice\n- Cap them', hn)).toEqual([])
    expect(disclosureProblems('Retries run twice.', hn)).toEqual(['Write the talking points, one per line beginning "- ".'])
    expect(disclosureProblems('- a\n- b\n- c\n- d', hn)).toEqual(['At most 3 talking points; this draft has 4.'])
  })

  it('refuses to check a reply or a post that names the sponsor for an account without an affiliation line', () => {
    expect(() => disclosureProblems('Formstep does that.', { ...CONTEXT, affiliationLine: ' ' })).toThrow(
      'the account has no affiliation line'
    )
    expect(() => postDisclosureProblems('Formstep does that.', { sponsorName: 'Formstep', affiliationLine: '', sponsored: true })).toThrow(
      'the account has no affiliation line'
    )
  })
})

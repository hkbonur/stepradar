/**
 * The sponsor's website as a visitor without JavaScript reads it: its words,
 * or why they could not be read. Read once to propose the sponsor's profile
 * (CONTEXT.md, "Product profile") and never stored.
 */
export type SiteRead = { read: true; text: string } | { read: false; why: string }

export interface SiteProvider {
  readonly name: string
  read(url: string): Promise<SiteRead>
}

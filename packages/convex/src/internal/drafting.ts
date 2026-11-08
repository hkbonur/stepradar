/**
 * The writers' one retry, for posts and replies alike: a draft is written
 * once, and once more with the problems named when the first breaks a rule.
 * The second draft's problems come back for the caller to act on: a post
 * fails with them, a reply is passed on with them.
 */
export async function draftChecked<Brief extends { problems: string[] }, Draft>(
  write: (brief: Brief) => Promise<Draft>,
  brief: Brief,
  problemsOf: (draft: Draft) => string[]
): Promise<{ draft: Draft; problems: string[] }> {
  const first = await write(brief)
  const firstProblems = problemsOf(first)
  if (firstProblems.length === 0) return { draft: first, problems: [] }
  const second = await write({ ...brief, problems: firstProblems })
  return { draft: second, problems: problemsOf(second) }
}

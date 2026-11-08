import { providersMode } from '../../lib/env'
import { anthropicLlm } from './anthropic'
import { mockLlm } from './mock'
import type { LlmProvider } from './types'

export function llmProvider(): LlmProvider {
  return providersMode() === 'real' ? anthropicLlm : mockLlm
}
export { POST_LENGTH_TARGETS } from './types'
export type {
  AccountPostSample,
  BriefSignal,
  AccountBrief,
  JudgeBrief,
  PostBrief,
  PostedLately,
  PostDraft,
  ReplyBrief,
  ReplyDraft,
  VoiceBrief,
  VoiceDraft,
  ChatTurn,
  PlanRow,
  TaskReportArgs,
  TaskSignal,
} from './types'

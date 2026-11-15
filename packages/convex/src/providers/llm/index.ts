import type { ProviderKeys } from '../../core/keys'
import { providersMode } from '../../lib/env'
import { anthropicLlm } from './anthropic'
import { mockLlm } from './mock'
import type { LlmProvider } from './types'

/** Claude on the operator's stored keys in real mode (core/keys.ts), else the mock. */
export function llmProvider(keys: ProviderKeys): LlmProvider {
  return providersMode() === 'real' ? anthropicLlm(keys) : mockLlm
}
export { POST_LENGTH_TARGETS } from './types'
export type {
  LlmProvider,
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

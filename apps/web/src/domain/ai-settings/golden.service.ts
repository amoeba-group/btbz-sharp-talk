import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';

/** Golden-question regression (PLN-260813 W4-A/B). */

export interface GoldenQuestion {
  id: number;
  question: string;
  language: string;
  note: string | null;
  active: boolean;
  /** Facts the answer must contain (PLN-261007 R7); empty = not graded. */
  expected: string[];
  forbidden: string[];
  createdAt: string;
}

export interface GoldenRun {
  id: number;
  kind: 'baseline' | 'after' | 'noise' | 'manual';
  label: string | null;
  proposalId: number | null;
  configHash: string;
  questionCount: number;
  truncated: boolean;
  status: string;
  aiAgentId: number | null;
  passCount: number;
  failCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface CompareSide {
  answer: string;
  confidence: number | null;
  citations: string[];
  blocked: boolean;
}

export interface CompareItem {
  question: string;
  base: CompareSide | null;
  target: CompareSide | null;
  confidenceDelta: number | null;
  lengthDelta: number | null;
  citationsChanged: boolean;
  textChanged: boolean;
  baseVerdict: string | null;
  targetVerdict: string | null;
  regressed: boolean;
  improved: boolean;
  targetFailedChecks: string[];
}

export interface Comparison {
  base: GoldenRun;
  target: GoldenRun;
  /** True when nothing in the config differs — so any change below is variance. */
  sameConfig: boolean;
  items: CompareItem[];
}

export const goldenService = {
  listQuestions: () => apiGet<{ items: GoldenQuestion[]; max: number }>('/ai-coach/golden/questions'),
  addQuestion: (body: { question: string; language?: string; note?: string; expected?: string[] }) =>
    apiPost<GoldenQuestion>('/ai-coach/golden/questions', body),
  bulkImport: (body: { text: string; language?: string }) =>
    apiPost<{ created: number; updated: number; skipped: number }>('/ai-coach/golden/questions/bulk', body),
  updateQuestion: (id: number, body: { question?: string; active?: number; expected?: string[] }) =>
    apiPatch<GoldenQuestion>(`/ai-coach/golden/questions/${id}`, body),
  removeQuestion: (id: number) => apiDelete<{ removed: boolean }>(`/ai-coach/golden/questions/${id}`),

  listRuns: () => apiGet<{ items: GoldenRun[] }>('/ai-coach/golden/runs'),
  createRun: (kind: 'manual' | 'noise', aiAgentId?: number | null, label?: string) =>
    apiPost<GoldenRun>('/ai-coach/golden/runs', {
      kind,
      label,
      ...(aiAgentId ? { ai_agent_id: aiAgentId } : {}),
    }),
  compare: (base: number, target: number) =>
    apiGet<Comparison>('/ai-coach/golden/compare', { base, target }),

  applyVerified: (proposalId: number) =>
    apiPost<{ proposal: unknown; comparison: Comparison }>(
      `/ai-coach/proposals/${proposalId}/apply-verified`,
      {},
    ),
};

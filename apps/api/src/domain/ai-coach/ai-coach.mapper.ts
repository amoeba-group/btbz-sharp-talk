import { CoachingThread } from './entity/coaching-thread.entity';
import { CoachingMessage } from './entity/coaching-message.entity';
import { CoachingProposal } from './entity/coaching-proposal.entity';
import { GoldenQuestion } from './entity/golden-question.entity';
import { GoldenRun } from './entity/golden-run.entity';

/** Response shaping — camelCase (code convention §2). Static mapper, no DI. */
export class AiCoachMapper {
  static toThread(t: CoachingThread) {
    return {
      id: Number(t.id),
      /** Which AI agent this thread coaches; null = the default agent. */
      aiAgentId: t.aiAgentId == null ? null : Number(t.aiAgentId),
      title: t.title,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  static toThreadList(rows: CoachingThread[]) {
    return rows.map((t) => AiCoachMapper.toThread(t));
  }

  static toMessage(m: CoachingMessage) {
    return {
      id: Number(m.id),
      role: m.role,
      body: m.body,
      citations: m.meta?.citations ?? [],
      blocked: m.meta?.blocked ?? false,
      provider: m.meta?.provider ?? null,
      refTurn: m.meta?.refTurn ?? null,
      createdAt: m.createdAt,
    };
  }

  static toProposal(p: CoachingProposal) {
    return {
      id: Number(p.id),
      messageId: Number(p.messageId),
      type: p.type,
      status: p.status,
      persona: p.payload?.persona ?? null,
      rule: p.payload?.rule ?? null,
      targetRule: p.payload?.targetRule ?? null,
      docId: p.payload?.docId ?? null,
      docTitle: p.payload?.docTitle ?? null,
      docCategory: p.payload?.docCategory ?? null,
      docContent: p.payload?.docContent ?? null,
      scenarioAction: p.payload?.scenarioAction ?? null,
      scenarioReply: p.payload?.scenarioReply ?? null,
      rationale: p.payload?.rationale ?? null,
      conflictsWith: p.payload?.conflictsWith ?? [],
      appliedAt: p.appliedAt,
      // payload.previous is intentionally omitted: it is rollback state, not
      // something the console renders, and it can hold a full persona.
    };
  }

  static toGoldenQuestion(q: GoldenQuestion) {
    return {
      id: Number(q.id),
      question: q.question,
      language: q.language,
      note: q.note,
      active: q.active === 1,
      expected: q.expected ?? [],
      forbidden: q.forbidden ?? [],
      createdAt: q.createdAt,
    };
  }

  static toGoldenRun(r: GoldenRun) {
    return {
      id: Number(r.id),
      kind: r.kind,
      label: r.label,
      proposalId: r.proposalId ? Number(r.proposalId) : null,
      configHash: r.configHash,
      questionCount: r.questionCount,
      truncated: r.truncated === 1,
      status: r.status,
      aiAgentId: r.aiAgentId != null ? Number(r.aiAgentId) : null,
      passCount: r.passCount ?? 0,
      failCount: r.failCount ?? 0,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    };
  }

  static toThreadDetail(
    thread: CoachingThread,
    messages: CoachingMessage[],
    proposals: CoachingProposal[],
  ) {
    return {
      thread: AiCoachMapper.toThread(thread),
      messages: messages.map((m) => AiCoachMapper.toMessage(m)),
      proposals: proposals.map((p) => AiCoachMapper.toProposal(p)),
    };
  }
}

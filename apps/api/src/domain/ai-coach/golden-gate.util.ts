/**
 * Post-deploy regression gate (PLN-261008) — pure parts.
 *
 * `GOLDEN_GATE=4:10,1:3` names which tenant's graded set to run as which AI
 * agent after a staging deploy. Empty = off.
 */
export interface GateTarget {
  tenantId: number;
  aiAgentId: number | null;
}

export function parseGateTargets(raw: string | undefined): GateTarget[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [t, a] = s.split(':').map((v) => v.trim());
      const tenantId = Number(t);
      const aiAgentId = a ? Number(a) : null;
      return Number.isInteger(tenantId) && tenantId > 0 && (aiAgentId === null || Number.isInteger(aiAgentId))
        ? { tenantId, aiAgentId }
        : null;
    })
    .filter((x): x is GateTarget => x !== null);
}

export interface GateResult {
  tenantId: number;
  aiAgentId: number | null;
  runId: number;
  pass: number;
  fail: number;
  total: number;
  failed: Array<{ question: string; checks: string[] }>;
  regressed: string[];
}

/** D1: any failing question fails the gate — regressions alone would miss what was wrong from the start. */
export function gateFailed(r: GateResult): boolean {
  return r.fail > 0 || r.regressed.length > 0;
}

export function gateMail(results: GateResult[], env: string, label: string): { subject: string; text: string } {
  const bad = results.filter(gateFailed);
  const subject = `[SharpTalk ${env}] 배포 후 FAQ 회귀 실패 — ${bad.map((r) => `tenant ${r.tenantId}: ✗${r.fail}`).join(', ')} (${label})`;
  const body: string[] = [`배포(${label}) 직후 FAQ 회귀 채점에서 실패가 나왔습니다. 배포는 그대로 유지됩니다(자동 롤백 없음).`, ''];
  for (const r of results) {
    body.push(
      `■ tenant ${r.tenantId} · agent ${r.aiAgentId ?? '—'} · run #${r.runId}: 통과 ${r.pass} / 실패 ${r.fail} / 전체 ${r.total}`,
    );
    if (r.regressed.length) body.push(`  회귀(통과→실패): ${r.regressed.join(' | ')}`);
    for (const f of r.failed.slice(0, 15)) body.push(`  ✗ ${f.question.slice(0, 90)} — ${f.checks.join(', ')}`);
    if (r.failed.length > 15) body.push(`  … 외 ${r.failed.length - 15}건`);
    body.push('');
  }
  body.push('확인: 콘솔 › AI 설정 › 회귀 검증 › 최근 실행 › 이전 실행과 비교');
  return { subject, text: body.join('\n') };
}

import { EXPECT_GATE, GATE_DECISION, gateMatchesExpectation, isExpectGate, isGateAs } from '@sharptalk/types';
import type { ExpectGate, GateAs, GateDecisionValue } from '@sharptalk/types';
import type { GradeResult } from './golden-grade.util';

/**
 * Grading the GATE of a golden question (PLN-261012 SG-51): a question asked as a viewer
 * (`audience`) may state what the gate should do (`expect_gate`: allow | refuse). The text grading
 * of golden-grade.util.ts is untouched; this adds the gate's own check and the rule that combines
 * the two into the run item's verdict.
 */

/** A stored or submitted viewer, or null (blank and unknown values never become a viewer). */
export function sanitizeAudience(raw: unknown): GateAs | null {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return isGateAs(v) ? v : null;
}

/** A stored or submitted expectation, or null. */
export function sanitizeExpectGate(raw: unknown): ExpectGate | null {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return isExpectGate(v) ? v : null;
}

/**
 * Did the gate do what the question says? No expectation (or a gate that did not run) is not
 * graded — null, like a question with no expected facts.
 */
export function gradeGate(
  expectGate: ExpectGate | null | undefined,
  decision: GateDecisionValue | null | undefined,
): GradeResult {
  if (!expectGate || !decision) return { verdict: null, failedChecks: [] };
  if (gateMatchesExpectation(expectGate, decision)) return { verdict: 'pass', failedChecks: [] };
  // "expected refuse, got allow" is a LEAK; "expected allow, got guest_gate" is an over-refusal.
  return { verdict: 'fail', failedChecks: [`gate: expected ${expectGate}, got ${decision}`] };
}

/**
 * The item's verdict from the text grade and the gate grade: any failed check fails it; otherwise
 * it passes when at least one of the two was graded and passed; otherwise it stays ungraded.
 */
export function combineGrades(text: GradeResult, gate: GradeResult): GradeResult {
  const failedChecks = [...text.failedChecks, ...gate.failedChecks];
  if (text.verdict === 'fail' || gate.verdict === 'fail') return { verdict: 'fail', failedChecks };
  if (text.verdict === 'pass' || gate.verdict === 'pass') return { verdict: 'pass', failedChecks };
  return { verdict: null, failedChecks };
}

/**
 * When the gate REFUSED a question that was expected to be refused, the "answer" is the gate's own
 * fixed notice: the facts the question lists (`expected`) are not a property of that text, so only
 * the gate is graded. In every other case the answer is graded as before.
 */
export function textGradeAppliesFacts(expectGate: ExpectGate | null | undefined, decision: GateDecisionValue | null | undefined): boolean {
  return !(expectGate === EXPECT_GATE.REFUSE && decision != null && decision !== GATE_DECISION.ALLOW);
}

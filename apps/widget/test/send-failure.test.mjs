/**
 * What the widget offers after a message did not go through (PLN-261012 SG-84).
 *
 * Run: node --test apps/widget/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const { outputFiles } = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/components/chat/send-failure.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'neutral',
});
const {
  RETRY_CHIP_ID,
  AGENT_CHIP_ID,
  SEND_TIMEOUT_MS,
  classifySendFailure,
  sendFailureChips,
  keepFailureTail,
  withoutFailures,
  maxServerId,
  failureBubble,
} = await import(`data:text/javascript,${encodeURIComponent(outputFiles[0].text)}`);

const LABELS = { retry: 'Retry', agent: 'Talk to an agent' };
const msg = (id, senderType, body = 'x') => ({ id, senderType, body, createdAt: '2026-10-13T00:00:00Z' });
const ids = (chips) => chips.map((c) => c.id);

test('a failure with no HTTP answer (offline, deadline) is a network failure', () => {
  assert.equal(classifySendFailure(new Error('Network Error')), 'network');
  assert.equal(classifySendFailure(Object.assign(new Error('timeout of 120000ms exceeded'), { status: undefined })), 'network');
  assert.equal(classifySendFailure(null), 'network');
});

test('5xx is a server failure; other 4xx is a refusal the server would repeat', () => {
  assert.equal(classifySendFailure(Object.assign(new Error('x'), { status: 500 })), 'server');
  assert.equal(classifySendFailure(Object.assign(new Error('x'), { status: 503 })), 'server');
  assert.equal(classifySendFailure(Object.assign(new Error('x'), { status: 400 })), 'rejected');
  assert.equal(classifySendFailure(Object.assign(new Error('x'), { status: 413 })), 'rejected');
});

test('network and server failures offer Retry AND Talk to an agent', () => {
  for (const kind of ['network', 'server']) {
    assert.deepEqual(ids(sendFailureChips(LABELS, kind)), [RETRY_CHIP_ID, AGENT_CHIP_ID]);
  }
  assert.deepEqual(sendFailureChips(LABELS, 'network'), [
    { id: 'retry_send', label: 'Retry' },
    { id: 'agent_connect', label: 'Talk to an agent' },
  ]);
});

test('a refusal offers only the agent: retrying the same request fails the same way', () => {
  assert.deepEqual(ids(sendFailureChips(LABELS, 'rejected')), [AGENT_CHIP_ID]);
});

test('with nothing to resend (a failed hand-off), only the agent chip is offered', () => {
  assert.deepEqual(ids(sendFailureChips(LABELS, 'network', false)), [AGENT_CHIP_ID]);
});

test('the agent chip reuses the id the post-answer chip uses, so one handler serves both', () => {
  assert.equal(AGENT_CHIP_ID, 'agent_connect');
});

const thread = (...ids) => ids.map(([id, who]) => msg(id, who));

test('maxServerId is the highest all-digit id; optimistic and failure ids do not count', () => {
  assert.equal(maxServerId(thread(['7', 'user'], ['12', 'ai'], ['local-1', 'user'], ['err-9', 'system'])), 12);
  assert.equal(maxServerId([]), 0);
});

test('a failure bubble remembers the highest server id seen when the send failed', () => {
  const bubble = failureBubble(thread(['7', 'user'], ['8', 'ai']), 'Sorry', [{ id: 'retry_send', label: 'Retry' }], new Date('2026-10-13T01:00:00Z'));
  assert.equal(bubble.failedAfterId, '8');
  assert.equal(bubble.senderType, 'system');
  assert.ok(bubble.id.startsWith('err-'));
  assert.deepEqual(ids(bubble.quickReplies), ['retry_send']);
});

test('the failure bubble survives a reconcile when nothing new has arrived — a send that never reached the server', () => {
  // The REAL case found in the local browser run: the server's last message is the PREVIOUS answer.
  const failure = failureBubble(thread(['7', 'user'], ['8', 'ai']), 'Sorry', []);
  const local = [msg('7', 'user'), msg('8', 'ai'), msg('local-1', 'user'), failure];

  assert.deepEqual(keepFailureTail(local, thread(['7', 'user'], ['8', 'ai'])), [failure]);
  // The server stored the shopper's own turn but wrote no reply: still nothing to show instead.
  assert.deepEqual(keepFailureTail(local, thread(['7', 'user'], ['8', 'ai'], ['9', 'user'])), [failure]);
  // A brand-new conversation with nothing stored.
  const first = failureBubble([], 'Sorry', []);
  assert.deepEqual(keepFailureTail([first], []), [first]);
});

test('the failure bubble is dropped once a reply NEWER than the failure exists (the turn landed late)', () => {
  const failure = failureBubble(thread(['7', 'user'], ['8', 'ai']), 'Sorry', []);
  const local = [msg('7', 'user'), msg('8', 'ai'), failure];

  assert.deepEqual(keepFailureTail(local, thread(['7', 'user'], ['8', 'ai'], ['9', 'user'], ['10', 'ai'])), []);
  assert.deepEqual(keepFailureTail(local, thread(['7', 'user'], ['8', 'ai'], ['9', 'user'], ['10', 'agent'])), []);
  assert.deepEqual(keepFailureTail(local, thread(['7', 'user'], ['8', 'ai'], ['9', 'user'], ['10', 'system'])), []);
});

test('a failure that is not the last local message is stale and is not carried over', () => {
  const failure = failureBubble([], 'Sorry', []);
  assert.deepEqual(keepFailureTail([failure, msg('local-2', 'user')], thread(['7', 'user'])), []);
  assert.deepEqual(keepFailureTail([], []), []);
});

test('a retry replaces the failure bubble rather than stacking another', () => {
  const thread = [msg('local-1', 'user'), msg('err-1', 'system'), msg('err-2', 'system')];
  assert.deepEqual(withoutFailures(thread).map((m) => m.id), ['local-1']);
});

test('the send deadline is generous (the server runs up to three bounded model calls per turn)', () => {
  assert.ok(SEND_TIMEOUT_MS >= 90_000);
});

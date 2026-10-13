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

test('the failure bubble survives a reconcile while it is still the latest thing in the thread', () => {
  const failure = msg('err-1', 'system');
  const local = [msg('local-1', 'user'), failure];

  // The server holds the shopper's turn but no reply: the send failed before one was written.
  assert.deepEqual(keepFailureTail(local, [msg('10', 'user')]), [failure]);
  // The server has nothing yet (first message of a new conversation).
  assert.deepEqual(keepFailureTail(local, []), [failure]);
});

test('the failure bubble is dropped once ANY reply exists after it (the turn landed late)', () => {
  const local = [msg('local-1', 'user'), msg('err-1', 'system')];

  assert.deepEqual(keepFailureTail(local, [msg('10', 'user'), msg('11', 'ai')]), []);
  assert.deepEqual(keepFailureTail(local, [msg('10', 'user'), msg('11', 'agent')]), []);
  assert.deepEqual(keepFailureTail(local, [msg('10', 'user'), msg('11', 'system')]), []);
});

test('a failure that is not the last local message is stale and is not carried over', () => {
  const local = [msg('err-1', 'system'), msg('local-2', 'user')];
  assert.deepEqual(keepFailureTail(local, [msg('10', 'user')]), []);
  assert.deepEqual(keepFailureTail([], []), []);
});

test('a retry replaces the failure bubble rather than stacking another', () => {
  const thread = [msg('local-1', 'user'), msg('err-1', 'system'), msg('err-2', 'system')];
  assert.deepEqual(withoutFailures(thread).map((m) => m.id), ['local-1']);
});

test('the send deadline is generous (the server runs up to three bounded model calls per turn)', () => {
  assert.ok(SEND_TIMEOUT_MS >= 90_000);
});

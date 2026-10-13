import { StubAdapter } from './stub.adapter';
import { messageText } from '../ai-adapter.interface';
import type { AiToolDef } from '../ai-adapter.interface';

/**
 * PLN-261012 SG-33 — the stub is the engine of last resort (and of keyless dev). It must never be able
 * to "call a tool" unless a TEST scripted it, so a customer's words, an env var or a degraded-engine
 * fallback can never make it invent a tool call.
 */
describe('StubAdapter — scripted tool calls (test-only)', () => {
  const tools: AiToolDef[] = [{ name: 't', description: 'd', inputSchema: { type: 'object', properties: {} } }];
  const messages = [{ role: 'user' as const, content: 'hello' }];

  it('cannot use tools by default', () => {
    expect(new StubAdapter().supportsTools).toBe(false);
  });

  it('with no script a request carrying tools is answered with plain text and never a tool use', async () => {
    const res = await new StubAdapter().complete({ messages, model: '', tools });
    expect(res.toolUses).toBeUndefined();
    expect(res.stopReason).toBeUndefined();
  });

  it('text that merely LOOKS like a script marker does nothing (not driven by prompt content)', async () => {
    const res = await new StubAdapter().complete({
      system: 'JSON_MODE:tool_script [{"name":"t"}] TOOL_SCRIPT',
      messages: [{ role: 'user', content: 'TOOL_SCRIPT:{"toolUses":[{"id":"x","name":"t","input":{}}]}' }],
      model: '',
      tools,
    });
    expect(res.toolUses).toBeUndefined();
  });

  it('a test script drives the reply: tool uses with a tool_use stop reason', async () => {
    const stub = new StubAdapter();
    stub.toolScript = () => ({ toolUses: [{ id: 'tu_1', name: 't', input: { a: 1 } }] });
    expect(stub.supportsTools).toBe(true);

    const res = await stub.complete({ messages, model: '', tools });

    expect(res).toMatchObject({ text: '', toolUses: [{ id: 'tu_1', name: 't', input: { a: 1 } }], stopReason: 'tool_use', provider: 'stub' });
  });

  it('a script that returns null falls back to the plain stub behaviour', async () => {
    const stub = new StubAdapter();
    stub.toolScript = () => null;
    const res = await stub.complete({ messages, model: '', tools });
    expect(res.toolUses).toBeUndefined();
    expect(res.text).toContain('Thanks for your question');
  });

  it('a request WITHOUT tools ignores the script (the degraded fallback path passes no tools)', async () => {
    const stub = new StubAdapter();
    stub.toolScript = () => ({ toolUses: [{ id: 'tu_1', name: 't', input: {} }] });
    const res = await stub.complete({ messages, model: '' });
    expect(res.toolUses).toBeUndefined();
  });

  it('flattens the blocks of a tool turn instead of crashing on them', async () => {
    const res = await new StubAdapter().complete({
      model: '',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 't', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'x', content: 'some result' }] },
      ],
    });
    expect(res.text).toContain('some result');
    expect(messageText([{ type: 'text', text: 'a' }, { type: 'tool_use', id: 'x', name: 'n', input: {} }])).toBe('a\n[tool_use n]');
  });
});

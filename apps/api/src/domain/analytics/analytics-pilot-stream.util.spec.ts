import { EventEmitter } from 'node:events';
import { pipeChunks } from './analytics-pilot-stream.util';
import type { WritableLike } from './analytics-pilot-stream.util';

/** An EventEmitter-shaped response whose `write` can be told to report back-pressure. */
class FakeRes extends EventEmitter implements WritableLike {
  written: string[] = [];
  ended = false;
  destroyed = false;
  destroyError: Error | undefined;
  writableFinished = false;
  /** Return false from the Nth write (1-based) to simulate a full socket buffer. */
  fullAfterWrite: number | null = null;
  private count = 0;

  write(chunk: string): boolean {
    this.count += 1;
    this.written.push(chunk);
    return this.fullAfterWrite === this.count ? false : true;
  }
  end(): void {
    this.ended = true;
    this.writableFinished = true;
  }
  destroy(err?: Error): void {
    this.destroyed = true;
    this.destroyError = err;
  }
}

async function* gen(items: Array<string | Error>, onYield?: (i: number) => void): AsyncGenerator<string> {
  for (let i = 0; i < items.length; i += 1) {
    onYield?.(i);
    const item = items[i];
    if (item instanceof Error) throw item;
    yield item;
  }
}

describe('pipeChunks — bounded-memory CSV streaming', () => {
  it('writes every chunk in order and ends the response', async () => {
    const res = new FakeRes();
    const out = await pipeChunks(res, gen(['﻿head\r\n', 'row1\r\n', 'row2\r\n']));
    expect(res.written).toEqual(['﻿head\r\n', 'row1\r\n', 'row2\r\n']);
    expect(res.ended).toBe(true);
    expect(out).toEqual({ chars: 'head\r\n'.length + 1 + 'row1\r\n'.length + 'row2\r\n'.length, aborted: false });
  });

  it('does not pull the next chunk until a full buffer drains (back-pressure)', async () => {
    const res = new FakeRes();
    res.fullAfterWrite = 1;
    const pulled: number[] = [];
    const done = pipeChunks(res, gen(['a', 'b', 'c'], (i) => pulled.push(i)));

    // Let the first write happen; the generator must NOT have been asked for the second chunk yet.
    await new Promise((r) => setImmediate(r));
    expect(res.written).toEqual(['a']);
    expect(pulled).toEqual([0]);

    res.emit('drain');
    await done;
    expect(res.written).toEqual(['a', 'b', 'c']);
    expect(pulled).toEqual([0, 1, 2]);
  });

  it('a client that hangs up while the buffer is full does not leave it waiting forever', async () => {
    const res = new FakeRes();
    res.fullAfterWrite = 1;
    const done = pipeChunks(res, gen(['a', 'b', 'c']));
    await new Promise((r) => setImmediate(r));
    res.destroyed = true;
    res.emit('close');
    const out = await done;
    expect(out.aborted).toBe(true);
    expect(res.written).toEqual(['a']); // nothing more was produced for a file nobody will read
    expect(res.ended).toBe(false);
  });

  it('stops the generator when the client goes away between chunks (no more queries)', async () => {
    const res = new FakeRes();
    let produced = 0;
    async function* source() {
      for (let i = 0; i < 100; i += 1) {
        produced += 1;
        yield `row${i}\r\n`;
        if (i === 2) {
          res.destroyed = true;
          res.emit('close');
        }
      }
    }
    const out = await pipeChunks(res, source());
    expect(out.aborted).toBe(true);
    expect(produced).toBeLessThan(10);
  });

  it('a generator that throws mid-file destroys the socket — the client sees a failed download, not a short file that looks complete', async () => {
    const res = new FakeRes();
    const boom = new Error('db went away');
    await expect(pipeChunks(res, gen(['head', boom, 'never']))).rejects.toBe(boom);
    expect(res.destroyed).toBe(true);
    expect(res.destroyError).toBe(boom);
    expect(res.ended).toBe(false);
  });

  it('skips empty chunks instead of writing zero-length pieces', async () => {
    const res = new FakeRes();
    await pipeChunks(res, gen(['a', '', 'b']));
    expect(res.written).toEqual(['a', 'b']);
  });

  it('removes its close listener when it is done (no listener leak across exports)', async () => {
    const res = new FakeRes();
    await pipeChunks(res, gen(['a']));
    expect(res.listenerCount('close')).toBe(0);
    expect(res.listenerCount('drain')).toBe(0);
  });
});

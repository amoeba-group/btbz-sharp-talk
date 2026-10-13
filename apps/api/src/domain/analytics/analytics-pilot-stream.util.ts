/**
 * The slice of an Express response the CSV export needs. A structural type (not `express.Response`) so
 * the back-pressure logic can be unit-tested with a plain EventEmitter-shaped fake.
 */
export interface WritableLike {
  write(chunk: string, encoding: 'utf8'): boolean;
  end(): unknown;
  destroy(error?: Error): unknown;
  once(event: 'drain' | 'close', listener: () => void): unknown;
  off(event: 'drain' | 'close', listener: () => void): unknown;
  readonly destroyed?: boolean;
  readonly writableFinished?: boolean;
}

export interface PipeResult {
  /** Characters written (the UTF-16 length, a close-enough size for an audit row). */
  chars: number;
  /** The client went away before the file was finished. */
  aborted: boolean;
}

/**
 * Write an async sequence of text chunks to a response with back-pressure, so a 5 000-row export is
 * paged through memory one page at a time instead of being built whole.
 *
 *  - `write()` returning false means the socket buffer is full: wait for `drain` (or `close`, so a
 *    client that vanished cannot leave this awaiting forever) before asking the generator for more.
 *  - a client that hangs up stops the generator (no more queries for a file nobody will read).
 *  - a generator that THROWS mid-file destroys the socket: the client sees a failed download, not a
 *    file that looks complete and is silently short. The error is rethrown for the caller to log.
 */
export async function pipeChunks(res: WritableLike, chunks: AsyncIterable<string>): Promise<PipeResult> {
  let aborted = false;
  const onClose = () => {
    if (!res.writableFinished) aborted = true;
  };
  res.once('close', onClose);
  let chars = 0;
  try {
    for await (const piece of chunks) {
      if (aborted || res.destroyed) {
        aborted = true;
        break;
      }
      if (!piece) continue;
      chars += piece.length;
      if (!res.write(piece, 'utf8')) {
        await new Promise<void>((resolve) => {
          const done = () => {
            res.off('drain', done);
            res.off('close', done);
            resolve();
          };
          res.once('drain', done);
          res.once('close', done);
        });
      }
    }
  } catch (err) {
    res.destroy(err as Error);
    throw err;
  } finally {
    res.off('close', onClose);
  }
  if (!aborted) res.end();
  return { chars, aborted };
}

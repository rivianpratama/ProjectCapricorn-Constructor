export function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createSseParser(onEvent: (event: string, data: unknown) => void): { push(chunk: string): void } {
  let buf = '';
  return {
    push(chunk: string) {
      // proxies may rewrite line endings to CRLF; a \r at the end of one chunk is fixed up by the next
      buf = (buf + chunk).replace(/\r\n/g, '\n');
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (!data.length) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.join('\n'));
        } catch {
          continue; // a malformed block is dropped; the stream goes on
        }
        try {
          onEvent(event, parsed);
        } catch (e) {
          // a bug in a handler must not cost the rest of the stream, nor vanish: rethrow it on its own
          queueMicrotask(() => { throw e; });
        }
      }
    },
  };
}

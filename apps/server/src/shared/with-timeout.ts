/**
 * Races a promise against a timer. Both Redis clients run with
 * `maxRetriesPerRequest: null`, so during an outage a command HANGS rather
 * than failing; anything on a request or alert path that touches Redis
 * must be bounded with this. Rejects with `<label> timed out after <ms>ms`.
 */
export const withTimeout = async <T>(p: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

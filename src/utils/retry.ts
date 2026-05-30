/**
 * Retry wrapper with exponential backoff.
 * Usage: await withRetry(() => axios.get(url), { label: 'remotive' })
 */
export async function withRetry<T>(
  fn:   () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; label?: string } = {},
): Promise<T> {
  const { attempts = 3, baseMs = 800, label = '' } = opts;
  let lastErr: unknown;

  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        const delay = baseMs * 2 ** (i - 1);
        if (label) console.warn(`  ↻  [${label}] attempt ${i}/${attempts} failed — retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Map over `items` with at most `limit` tasks in flight. Preserves order.
 * Errors are captured per-item via the mapper's own handling; a mapper that
 * throws rejects the whole run, so mappers here should catch and encode
 * failures in their return value.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index] as T, index);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}

export async function* orderedBatches<T, R>(items: T[], concurrency: number, work: (value: T, index: number) => Promise<R>, signal?: AbortSignal) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('并发数无效');
  for (let start = 0; start < items.length; start += concurrency) {
    signal?.throwIfAborted();
    const group = await Promise.all(items.slice(start, start + concurrency).map(async (value, offset) => {
      signal?.throwIfAborted();
      const index = start + offset;
      const result = await work(value, index);
      signal?.throwIfAborted();
      return {value, index, result};
    }));
    signal?.throwIfAborted();
    yield group;
  }
}

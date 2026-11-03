import { zipSync } from 'fflate';
import { orderedBatches } from './concurrency.ts';
import { safeSegment, type Entry, type Target } from './core.ts';

export const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_BATCH_BYTES = 64 * 1024 * 1024;
export interface DownloadPort {
  load(entry: Entry, signal: AbortSignal): Promise<Uint8Array>;
  save(name: string, bytes: Uint8Array): Promise<void>;
  progress?(completed: number, total: number, failed: number): void;
}

function uniqueLabel(name: string, used: Set<string>): string {
  const base = safeSegment(name);
  let label = base, suffix = 1;
  while (used.has(label.toLocaleLowerCase())) label = `${base}_${++suffix}`;
  used.add(label.toLocaleLowerCase());
  return label;
}

function archiveLayout(targets: Target[], entries: Entry[]) {
  const shops = new Map<string, {name: string; views: Map<string, string>}>();
  const usedShops = new Set<string>();
  for (const target of [...targets, ...entries]) {
    let shop = shops.get(target.tableId);
    if (!shop) {
      shop = {name: uniqueLabel(target.tableName, usedShops), views: new Map()};
      shops.set(target.tableId, shop);
    }
    if (!shop.views.has(target.viewId)) {
      const label = target.viewName.includes('新收到校样') ? '新收到校样' : target.viewName.includes('修改') ? '修改' : target.viewName;
      shop.views.set(target.viewId, uniqueLabel(label, new Set([...shop.views.values()].map(x => x.toLocaleLowerCase()))));
    }
  }
  return shops;
}

export async function downloadEntries(entries: Entry[], port: DownloadPort, signal: AbortSignal, targets: Target[] = []): Promise<{success: number; failed: number; parts: number; failures: {tableName: string; viewName: string; filename: string}[]}> {
  const layout = archiveLayout(targets, entries);
  const multipleShops = layout.size > 1;
  const singleShopName = layout.values().next().value?.name || '校样下载';
  let batches = new Map<string, {files: Record<string, Uint8Array>}>();
  const failures: {tableName: string; viewName: string; filename: string}[] = [];
  let bytes = 0, count = 0, part = 0, success = 0, failed = 0;
  const flush = async (hasMore: boolean) => {
    if (!batches.size) return;
    signal.throwIfAborted();
    const outer: Record<string, Uint8Array> = {};
    let singleZip: Uint8Array | undefined;
    for (const [tableId, batch] of batches) {
      const inner = zipSync(batch.files, {level: 0});
      batch.files = {};
      if (multipleShops) outer[`${layout.get(tableId)!.name}.zip`] = inner;
      else singleZip = inner;
    }
    const zip = multipleShops ? zipSync(outer, {level: 0}) : singleZip!;
    batches = new Map(); bytes = 0; count = 0;
    const numbered = part > 0 || hasMore;
    const baseName = multipleShops ? '校样下载' : singleShopName;
    const filename = `${baseName}${numbered ? `_${part + 1}` : ''}.zip`;
    signal.throwIfAborted();
    await port.save(filename, zip);
    part++;
  };
  for await (const group of orderedBatches(entries, 2, async entry => {
    try {
      if (entry.size > MAX_FILE_BYTES) throw new Error('文件过大');
      const data = await port.load(entry, signal);
      signal.throwIfAborted();
      if (data.byteLength > MAX_FILE_BYTES) throw new Error('文件过大');
      return data;
    } catch {
      signal.throwIfAborted();
      return null;
    }
  }, signal)) {
   for (const {value: entry, index: i, result: data} of group) {
    signal.throwIfAborted();
    if (count >= 20 || (bytes && bytes + entry.size > MAX_BATCH_BYTES)) await flush(true);
    const shop = layout.get(entry.tableId)!;
    const path = shop.views.size > 1 ? `${shop.views.get(entry.viewId)!}/${entry.filename}` : entry.filename;
    if (data && bytes && bytes + data.byteLength > MAX_BATCH_BYTES) await flush(true);
    if (data) {
      let batch = batches.get(entry.tableId);
      if (!batch) { batch = {files: {}}; batches.set(entry.tableId, batch); }
      if (path in batch.files) throw new Error('文件名冲突，已停止打包。');
      batch.files[path] = data; bytes += data.byteLength; count++; success++;
    } else {
      failed++;
      failures.push({tableName: entry.tableName, viewName: entry.viewName, filename: entry.filename});
    }
    port.progress?.(i + 1, entries.length, failed);
  }
  }
  await flush(false);
  return {success, failed, parts: part, failures};
}

export async function fetchBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  if (new URL(url).protocol !== 'https:') throw new Error('下载地址不是 HTTPS。');
  const timeoutSignal = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
  const response = await fetch(url, {signal: timeoutSignal, credentials: 'omit', referrerPolicy: 'no-referrer'});
  if (!response.ok || !response.body) throw new Error('下载失败');
  const declared = Number(response.headers.get('content-length') || 0);
  const mime = response.headers.get('content-type') || '';
  if (declared > MAX_FILE_BYTES || /text\/html|application\/json/i.test(mime)) {
    await response.body.cancel();
    throw new Error('返回内容不是附件或超出大小限制');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) throw new Error('文件过大');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!size) throw new Error('附件为空');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

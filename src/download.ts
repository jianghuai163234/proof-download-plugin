import { zipSync, strToU8 } from 'fflate';
import type { Entry } from './core.ts';

export const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_BATCH_BYTES = 64 * 1024 * 1024;
export interface DownloadPort {
  load(entry: Entry, signal: AbortSignal): Promise<Uint8Array>;
  save(name: string, bytes: Uint8Array): Promise<void>;
  progress?(completed: number, total: number, failed: number): void;
}

export async function downloadEntries(entries: Entry[], port: DownloadPort, signal: AbortSignal): Promise<{success: number; failed: number; parts: number}> {
  let files: Record<string, Uint8Array> = {};
  let bytes = 0, count = 0, part = 0, success = 0, failed = 0;
  let notes: string[] = ['附件下载清单（仅记录计划文件名，不记录临时下载链接）'];
  const flush = async () => {
    if (!count && notes.length === 1) return;
    signal.throwIfAborted();
    files['下载清单.txt'] = strToU8(notes.join('\r\n'));
    const zip = zipSync(files, {level: 0});
    files = {}; bytes = 0; count = 0; notes = [notes[0]];
    signal.throwIfAborted();
    await port.save(`附件下载_${new Date().toISOString().replace(/[:.]/g, '-')}_${++part}.zip`, zip);
  };
  for (const [i, entry] of entries.entries()) {
    signal.throwIfAborted();
    if (count >= 20 || (bytes && bytes + entry.size > MAX_BATCH_BYTES)) await flush();
    let data: Uint8Array | null = null;
    try {
      if (entry.size > MAX_FILE_BYTES) throw new Error('文件过大');
      data = await port.load(entry, signal);
      signal.throwIfAborted();
      if (data.byteLength > MAX_FILE_BYTES) throw new Error('文件过大');
    } catch {
      signal.throwIfAborted();
      data = null;
      failed++;
      notes.push(`失败：${entry.folder}/${entry.filename}（请检查下载权限、文件大小或网络后重试；单文件上限 64 MiB）`);
    }
    if (data) {
      if (bytes && bytes + data.byteLength > MAX_BATCH_BYTES) await flush();
      const path = `${entry.folder}/${entry.filename}`;
      if (path in files) throw new Error('文件名冲突，已停止打包。');
      files[path] = data; bytes += data.byteLength; count++; success++;
      notes.push(`成功：${path}`);
    }
    port.progress?.(i + 1, entries.length, failed);
  }
  await flush();
  return {success, failed, parts: part};
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

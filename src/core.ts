export type Naming = 'image' | 'buyer';
export interface Attachment { name: string; token: string; size: number; type?: string }
export interface Row { id: string; buyer: string; attachments: Attachment[] }
export interface Target { tableId: string; viewId: string; tableName: string; viewName: string; fieldId: string }
export interface Entry extends Attachment, Target { recordId: string; filename: string; folder: string; index: number }

export function inferAttachmentField(view: string): string | null {
  if (view.includes('新收到校样')) return '校样1';
  if (view.includes('修改')) return '最新校样';
  return null;
}

export function safeSegment(value: string): string {
  let result = value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 90);
  if (!result) result = '未命名';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(result)) result = `_${result}`;
  return result;
}

export async function collectPages<T>(read: (token?: number) => Promise<{items: T[]; hasMore: boolean; next?: number}>, signal?: AbortSignal): Promise<T[]> {
  const result: T[] = [];
  const seen = new Set<number>();
  let token: number | undefined;
  for (let page = 0; page < 10000; page++) {
    signal?.throwIfAborted();
    const response = await read(token);
    result.push(...response.items);
    if (!response.hasMore) return result;
    if (response.next === undefined || response.items.length === 0 || seen.has(response.next) || response.next === 0) throw new Error('分页异常，已停止，避免漏下载或重复下载。');
    seen.add(response.next);
    token = response.next;
  }
  throw new Error('分页数量超出限制，请缩小筛选范围。');
}

export function makeManifest(target: Target, rows: Row[], naming: Naming): Entry[] {
  const entries: Entry[] = [];
  // IDs keep folders distinct even if two names become identical after sanitizing.
  const folder = `${safeSegment(target.tableName)}_${target.tableId}/${safeSegment(target.viewName)}_${target.viewId}`;
  for (const row of rows) {
    for (const attachment of row.attachments) {
      const index = entries.length + 1;
      const ext = /\.([a-zA-Z0-9]{1,10})$/.exec(attachment.name)?.[1]?.toLowerCase();
      const stem = naming === 'image' ? `image${index}` : `${index}_${safeSegment(row.buyer || '未填买家姓名')}`;
      entries.push({...target, ...attachment, recordId: row.id, index, folder, filename: `${stem}${ext ? `.${ext}` : ''}`});
    }
  }
  return entries;
}

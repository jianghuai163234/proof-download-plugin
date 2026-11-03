import { collectPages, type Attachment, type Naming, type Row, type Target } from './core.ts';

export interface ReadTable {
  getRecordIdListByPage(params: {viewId: string; pageSize: number; pageToken?: number}): Promise<{recordIds: string[]; hasMore: boolean; pageToken?: number}>;
  getCellValue(fieldId: string, recordId: string): Promise<unknown>;
  getCellString(fieldId: string, recordId: string): Promise<string>;
}

function attachments(value: unknown): Attachment[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('附件格式不支持，请检查目标列是否为附件字段。');
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || !('token' in item) || !('name' in item) || !('size' in item) || typeof item.token !== 'string' || typeof item.name !== 'string' || typeof item.size !== 'number' || !Number.isFinite(item.size) || item.size < 0) throw new Error('附件信息不完整，已停止读取。');
    return {token: item.token, name: item.name, size: item.size};
  });
}

export async function readRows(table: ReadTable, target: Target, naming: Naming, buyerFieldId?: string, signal?: AbortSignal): Promise<Row[]> {
  if (naming === 'buyer' && !buyerFieldId) throw new Error('未找到“买家姓名”字段，请选择姓名列或改用 image 编号。');
  const ids = await collectPages(async pageToken => {
    const page = await table.getRecordIdListByPage({viewId: target.viewId, pageSize: 200, pageToken});
    return {items: page.recordIds, hasMore: page.hasMore, next: page.pageToken};
  }, signal);
  if (ids.length !== new Set(ids).size) throw new Error('视图读取出现重复记录，可能正在发生变化，请刷新重试。');
  if (ids.length > 10000) throw new Error('当前超过一万条记录，请先在飞书缩小筛选范围。');
  const rows: Row[] = [];
  for (const id of ids) {
    signal?.throwIfAborted();
    const values = attachments(await table.getCellValue(target.fieldId, id));
    const buyer = naming === 'buyer' && values.length ? await table.getCellString(buyerFieldId!, id) : '';
    rows.push({id, buyer, attachments: values});
  }
  signal?.throwIfAborted();
  // Detect row/filter/order changes during the read rather than exporting a mixed list.
  const finalIds = await collectPages(async pageToken => {
    const page = await table.getRecordIdListByPage({viewId: target.viewId, pageSize: 200, pageToken});
    return {items: page.recordIds, hasMore: page.hasMore, next: page.pageToken};
  }, signal);
  if (JSON.stringify(ids) !== JSON.stringify(finalIds)) throw new Error('读取期间视图记录或顺序发生变化，请重试。');
  return rows;
}

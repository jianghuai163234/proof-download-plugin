import { bitable, FieldType, ViewType } from '@lark-base-open/js-sdk';
import { inferAttachmentField, type Entry, type Naming, type Target } from './core.ts';
import { readRows } from './reader.ts';
import { fetchBytes } from './download.ts';

export interface Choice { id: string; name: string }
export interface Context extends Target {
  fields: Choice[];
  buyerFields: Choice[];
  buyerFieldId?: string;
  grouped: boolean;
  filterCount: number;
  sortCount: number;
}

export async function getContext(tableId?: string, viewId?: string): Promise<Context> {
  const selection = !tableId || !viewId ? await bitable.base.getSelection() : null;
  const selectedTable = tableId || selection?.tableId;
  const selectedView = viewId || selection?.viewId;
  if (!selectedTable || !selectedView) throw new Error('请先打开店铺的表格视图，再刷新识别。仪表盘不支持直接下载。');
  const table = await bitable.base.getTableById(selectedTable);
  const view = await table.getViewById(selectedView);
  const [tableName, meta, fields] = await Promise.all([table.getName(), view.getMeta(), table.getFieldMetaList()]);
  if (meta.type !== ViewType.Grid) throw new Error('目前仅支持表格视图，请切换到店铺订单表格。');
  const candidates = fields.filter(f => f.type === FieldType.Attachment).map(f => ({id: f.id, name: f.name}));
  const buyerFields = fields.filter(f => f.type === FieldType.Text).map(f => ({id: f.id, name: f.name}));
  const expected = inferAttachmentField(meta.name);
  const matching = candidates.filter(f => f.name.trim() === expected);
  const buyer = buyerFields.find(f => f.name.trim() === '买家姓名');
  const property = meta.property as {groupInfo?: unknown[]; filterInfo?: {conditions?: unknown[]}; sortInfo?: unknown[]};
  return {
    tableId: selectedTable, viewId: selectedView, tableName, viewName: meta.name,
    fieldId: matching.length === 1 ? matching[0].id : '', fields: candidates,
    buyerFields, buyerFieldId: buyer?.id, grouped: Boolean(property.groupInfo?.length),
    filterCount: property.filterInfo?.conditions?.length || 0, sortCount: property.sortInfo?.length || 0,
  };
}

export async function getTables(): Promise<Choice[]> {
  return (await bitable.base.getTableMetaList()).map(t => ({id: t.id, name: t.name}));
}
export async function getViews(tableId: string): Promise<Choice[]> {
  const table = await bitable.base.getTableById(tableId);
  return (await table.getViewMetaList()).filter(v => v.type === ViewType.Grid).map(v => ({id: v.id, name: v.name}));
}
export function watchSelection(callback: () => void): () => void {
  return bitable.base.onSelectionChange(callback);
}
export async function readContextRows(context: Context, naming: Naming, signal: AbortSignal) {
  const table = await bitable.base.getTableById(context.tableId);
  return readRows(table, context, naming, context.buyerFieldId, signal);
}
export async function loadAttachment(entry: Entry, signal: AbortSignal): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    try {
      const table = await bitable.base.getTableById(entry.tableId);
      // Resolve only the planned attachment token, avoiding mismatches if a cell is edited.
      const urls = await table.getCellAttachmentUrls([entry.token], entry.fieldId, entry.recordId);
      if (urls.length !== 1) throw new Error('附件链接不可用');
      return await fetchBytes(urls[0], signal);
    } catch {
      signal.throwIfAborted();
      if (attempt === 1) throw new Error('附件下载失败，请检查权限、网络及附件是否已变更。');
    }
  }
  throw new Error('附件下载失败');
}

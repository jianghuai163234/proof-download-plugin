import type { Context, Choice } from './feishu.ts';
import type { Entry, Naming, Row } from './core.ts';

export const demoTables: Choice[] = [{id:'demo-mike',name:'Mike店订单'}, {id:'demo-judy',name:'Judy店订单'}];
export const demoViews: Choice[] = [{id:'demo-new',name:'（客服）新收到校样'}, {id:'demo-change',name:'⚠️(All) 修改'}];
export async function demoContext(tableId = 'demo-mike', viewId = 'demo-change'): Promise<Context> {
  return {tableId,viewId,tableName:demoTables.find(t => t.id === tableId)?.name || '示例店铺',viewName:demoViews.find(v => v.id === viewId)?.name || '示例视图',fieldId:viewId === 'demo-new' ? 'proof' : 'latest', fields:[{id:'proof',name:'校样1'},{id:'latest',name:'最新校样'}],buyerFields:[{id:'buyer',name:'买家姓名'}],buyerFieldId:'buyer',grouped:viewId === 'demo-change',filterCount:1,sortCount:2};
}
export async function demoRows(_context: Context, _naming: Naming, signal: AbortSignal): Promise<Row[]> {
  signal.throwIfAborted();
  const rows: Row[] = [
    {id:'r1',buyer:'示例买家A',attachments:[{name:'sample.svg',token:'a',size:200}]},
    {id:'r2',buyer:'示例买家B',attachments:[]},
    {id:'r3',buyer:'示例买家C',attachments:[{name:'sample.svg',token:'b',size:200},{name:'sample.svg',token:'c',size:200}]},
  ];
  return rows.map(row => ({...row, attachments: (_context.fieldIds || [_context.fieldId]).flatMap(fieldId => row.attachments.map(a => ({...a, fieldId})))}));
}
export async function demoLoad(entry: Entry, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  return new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#edf2ff"/><text x="300" y="300" text-anchor="middle" font-size="40" fill="#335cff">Demo ${entry.index}</text></svg>`);
}

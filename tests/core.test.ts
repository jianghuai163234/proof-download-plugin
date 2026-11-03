import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPages, inferAttachmentField, makeManifest, safeSegment } from '../src/core.ts';

test('view mapping avoids guessing for unrelated views', () => {
  assert.equal(inferAttachmentField('（客服）新收到校样'), '校样1');
  assert.equal(inferAttachmentField('⚠️(All) 修改'), '最新校样');
  assert.equal(inferAttachmentField('总订单'), null);
});
test('all pages retain view order and never silently accept broken pagination', async () => {
  const ids = Array.from({length: 203}, (_,i)=>`r${203-i}`);
  assert.deepEqual(await collectPages(async token => ({items: token ? ids.slice(200) : ids.slice(0,200),hasMore: !token,next: token ? undefined : 200})),ids);
  await assert.rejects(collectPages(async () => ({items:['r1'],hasMore:true})),/分页/);
  await assert.rejects(collectPages(async () => ({items:['r1'],hasMore:true,next:0})),/分页|重复/);
});
test('number attachments before download, skipping empty rows, preserving intra-cell order', () => {
  const rows=[{id:'r3',buyer:'乙',attachments:[{name:'b.PNG',size:2,token:'b'},{name:'c.jpg',size:3,token:'c'}]}, {id:'r1',buyer:'甲',attachments:[]}, {id:'r2',buyer:'乙',attachments:[{name:'z.jpg',size:1,token:'z'}]}];
  const result=makeManifest({tableId:'t',viewId:'v',tableName:'Mike/店',viewName:'修改',fieldId:'f'},rows,'buyer');
  assert.deepEqual(result.map(x=>x.filename),['1_乙.png','2_乙.jpg','3_乙.jpg']);
  assert.deepEqual(result.map(x=>x.token),['b','c','z']);
  assert.deepEqual(makeManifest({tableId:'t',viewId:'v',tableName:'Mike',viewName:'修改',fieldId:'f'},rows,'image').map(x=>x.filename),['image1.png','image2.jpg','image3.jpg']);
});
test('safe names keep Chinese and cannot escape ZIP folders', () => {
  assert.equal(safeSegment('../店铺/名称'), '_店铺_名称');
  assert.equal(safeSegment('CON'), '_CON');
  assert.equal(safeSegment('   '),'未命名');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readRows, type ReadTable } from '../src/reader.ts';
import { makeManifest } from '../src/core.ts';
import { downloadEntries } from '../src/download.ts';
import { unzipSync } from 'fflate';
const target={tableId:'t',viewId:'v',tableName:'Mike',viewName:'修改',fieldId:'f'};
function tableStub(): ReadTable {
 return {
  getRecordIdListByPage: async p=>{ assert.equal(p.viewId,'v'); assert.equal('filter' in p,false); assert.equal('sort' in p,false); return {recordIds:['r2','r1'],hasMore:false}; },
  getCellValue: async (_field,id)=>id==='r2'?[{name:'x.png',token:'token2',size:1}]:[],
  getCellString: async ()=> '买家',
 };
}
test('read respects view ID and order; only calls buyer field when needed',async()=>{
 const table=tableStub();
 table.getCellString=async ()=>{throw new Error('must not read buyer');};
 const rows=await readRows(table,target,'image');
 assert.deepEqual(rows.map(x=>x.id),['r2','r1']);
});
test('read errors never produce a partial silently successful manifest',async()=>{
 const table=tableStub(); table.getCellValue=async ()=>{throw new Error('denied');};
 await assert.rejects(readRows(table,target,'image'),/denied/);
});
test('cancellation stops reads',async()=>{
 const c=new AbortController();c.abort();
 await assert.rejects(readRows(tableStub(),target,'image',undefined,c.signal),{name:'AbortError'});
});
test('download failure preserves planned names and creates failure list without URLs',async()=>{
 const entries=makeManifest(target,[{id:'r',buyer:'张三',attachments:[{name:'a.png',token:'a',size:1},{name:'b.png',token:'b',size:1},{name:'c.png',token:'c',size:1}]}],'image');
 const archives:Uint8Array[]=[];
 const result=await downloadEntries(entries,{
  load: async e=>{ if(e.token==='b') throw new Error('https://private.example/?secret=x');return new Uint8Array([e.index]); },
  save:async (_name,bytes)=>{archives.push(bytes);},
 },new AbortController().signal);
 assert.equal(result.success,2); assert.equal(result.failed,1);
 const files=unzipSync(archives[0]);
 assert.ok(Object.keys(files).some(x=>x === 'image1.png'));
 assert.ok(Object.keys(files).some(x=>x === 'image3.png'));
 assert.equal(Object.keys(files).some(x=>x === 'image2.png'),false);
 assert.equal(new TextDecoder().decode(files['下载清单.txt']).includes('secret=x'),false);
});
test('batch limits and cancellation prevent subsequent saves',async()=>{
 const entries=makeManifest(target,[{id:'r',buyer:'a',attachments:[{name:'a.jpg',token:'a',size:1},{name:'b.jpg',token:'b',size:1}]}],'image');
 const c=new AbortController();let saves=0;
 await assert.rejects(downloadEntries(entries,{load:async()=>{c.abort();return new Uint8Array([1]);},save:async()=>{saves++;}},c.signal),{name:'AbortError'});
 assert.equal(saves,0);
});
test('ZIP save failure aborts the task instead of reporting a completed batch',async()=>{
 const entries=makeManifest(target,[{id:'r',buyer:'a',attachments:Array.from({length:21},(_,i)=>({name:`${i}.jpg`,token:String(i),size:1}))}],'image');
 await assert.rejects(downloadEntries(entries,{load:async()=>new Uint8Array([1]),save:async()=>{throw new Error('save failed');}},new AbortController().signal),/save failed/);
});
test('changing filtered order during read stops export',async()=>{
 const table=tableStub();let calls=0;
 table.getRecordIdListByPage=async()=>({recordIds:++calls===1?['r2','r1']:['r1','r2'],hasMore:false});
 await assert.rejects(readRows(table,target,'image'),/发生变化/);
});

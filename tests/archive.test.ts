import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { makeManifest, type Target } from '../src/core.ts';
import { downloadEntries } from '../src/download.ts';
const shop:Target={tableId:'t1',tableName:'Jesse店订单',viewId:'v1',viewName:'（客服）新收到校样',fieldId:'f'};
function entries(t:Target,count=1){return makeManifest(t,[{id:'r',buyer:'张三',attachments:Array.from({length:count},(_,i)=>({token:`a${i}`,name:'a.jpg',size:1}))}],'image');}
async function run(targets:Target[],counts=targets.map(()=>1)){
 const output:{name:string;files:ReturnType<typeof unzipSync>}[]=[];
 await downloadEntries(targets.flatMap((t,i)=>entries(t,counts[i])),{load:async e=>new Uint8Array([e.index]),save:async(name,bytes)=>{output.push({name,files:unzipSync(bytes)});}},new AbortController().signal,targets);
 return output;
}
test('single shop single view produces named ZIP with files at root',async()=>{
 const [out]=await run([shop]);
 assert.equal(out.name,'Jesse店订单.zip');assert.ok(out.files['image1.jpg']);
 assert.equal(Object.keys(out.files).some(x=>x.includes('/')),false);
});
test('single shop multiple views use only view folders, with independent numbering',async()=>{
 const [out]=await run([shop,{...shop,viewId:'v2',viewName:'⚠️(All) 修改'}]);
 assert.equal(out.name,'Jesse店订单.zip');assert.ok(out.files['新收到校样/image1.jpg']);assert.ok(out.files['修改/image1.jpg']);
 assert.equal(Object.keys(out.files).some(x=>x.startsWith('Jesse')),false);
});
test('multiple shops create outer 校样下载.zip and per-shop ZIPs following their own view counts',async()=>{
 const other={...shop,tableId:'t2',tableName:'Mike店订单'};
 const [out]=await run([shop,other,{...other,viewId:'v2',viewName:'修改'}]);
 assert.equal(out.name,'校样下载.zip');
 assert.deepEqual(Object.keys(out.files),['Jesse店订单.zip','Mike店订单.zip']);
 assert.ok(unzipSync(out.files['Jesse店订单.zip'])['image1.jpg']);
 const mike=unzipSync(out.files['Mike店订单.zip']);assert.ok(mike['新收到校样/image1.jpg']);assert.ok(mike['修改/image1.jpg']);
});
test('selected empty view still determines folder structure',async()=>{
 const [out]=await run([shop,{...shop,viewId:'v2',viewName:'修改'}],[1,0]);
 assert.ok(out.files['新收到校样/image1.jpg']);
});
test('split ZIP filenames are numbered and planned image numbers stay unchanged',async()=>{
 const out=await run([shop],[21]);
 assert.deepEqual(out.map(x=>x.name),['Jesse店订单_1.zip','Jesse店订单_2.zip']);
 assert.ok(out[0].files['image20.jpg']);assert.ok(out[1].files['image21.jpg']);
});
test('sanitized or repeated shop and view names never overwrite archives',async()=>{
 const other={...shop,tableId:'t2',tableName:'Jesse店订单'};
 const [out]=await run([shop,other]);
 assert.equal(Object.keys(out.files).length,2);
 const [views]=await run([shop,{...shop,viewId:'v2',viewName:'新收到校样'}]);
 assert.equal(Object.keys(views.files).filter(x=>x.endsWith('image1.jpg')).length,2);
});

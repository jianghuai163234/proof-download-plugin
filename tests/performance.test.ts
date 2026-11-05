import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { makeManifest } from '../src/core.ts';
import { downloadEntries } from '../src/download.ts';
import { readRows, type ReadTable } from '../src/reader.ts';
const target={tableId:'t',viewId:'v',tableName:'店铺',viewName:'修改',fieldId:'f'};
const entries=(count=4)=>makeManifest(target,[{id:'r',buyer:'买家',attachments:Array.from({length:count},(_,i)=>({name:'a.jpg',token:`t${i}`,size:1}))}],'image');
test('download overlaps six files, bounds concurrency, and preserves planned ZIP order',async()=>{
 let active=0,max=0;const output:Uint8Array[]=[];
 await downloadEntries(entries(8),{load:async e=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,e.index===1?12:1));active--;return new Uint8Array([e.index]);},save:async(_n,b)=>{output.push(b);}},new AbortController().signal);
 assert.equal(max,6);assert.equal(active,0);
 const files=unzipSync(output[0]);assert.deepEqual(Object.keys(files),Array.from({length:8},(_,i)=>`image${i+1}.jpg`));
 assert.deepEqual(Array.from(files['image1.jpg']),[1]);
});
test('all failures return panel-safe names and never generate empty ZIP or TXT',async()=>{
 let saves=0;
 const result=await downloadEntries(entries(),{load:async()=>{throw Error('secret URL');},save:async()=>{saves++;}},new AbortController().signal);
 assert.equal(saves,0);assert.equal(result.failed,4);assert.equal(result.parts,0);
 assert.deepEqual(result.failures.map(x=>x.filename),['image1.jpg','image2.jpg','image3.jpg','image4.jpg']);
 assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(JSON.stringify(result).includes('token'),false);
});
test('reader overlaps at most four rows and restores original view order',async()=>{
 let active=0,max=0;
 const table:ReadTable={getRecordIdListByPage:async()=>({recordIds:['r4','r3','r2','r1','r0'],hasMore:false}),getCellString:async()=>'',getCellValue:async(_f,id)=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,id==='r4'?12:1));active--;return [];}};
 const rows=await readRows(table,target,'image');assert.equal(max,4);assert.deepEqual(rows.map(x=>x.id),['r4','r3','r2','r1','r0']);
});

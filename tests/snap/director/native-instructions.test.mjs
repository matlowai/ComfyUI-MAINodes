// SNAP-R93/R273: exercise the real instruction resolver and queue pin, without a server or graph writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../../../web/snap/instructions.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
const plain=x=>JSON.parse(JSON.stringify(x));
function native() {
 const notes=[{scope:'book:film',text:'Keep this production blue.'},{scope:'book:other',text:'Keep that production red.'},{scope:'scene:s1',text:'Use this scene.'}].map((body,i)=>({kind:'instruction',id:`note${i}`,head:1,created:i,versions:[{n:1,body:{kind:'note',...body}}]}));
 const W={onChange(){},onWritten(){},load:async()=>{},all:kind=>kind==='instruction'?notes:[],headOf:r=>r.versions[0],refOf:(k,id,n)=>`${k}:${id}@${n}`,short:s=>s.slice(0,12),sha:async x=>JSON.stringify(x),get:ref=>ref==='book:film'?{version:{body:{scenes:['s1']}}}:null};
 const api={getUserData:async()=>({status:404}),fetchApi:async route=>({ok:true,json:async()=>route.endsWith('pack_notes')?{notes:[{id:'global',scope:'global',kind:'note',text:'Native pack note.'}],install:[]}:{skills:[]}})};
 const context=vm.createContext({W,api,E:{state:()=>({bricks:[],world:{}})},S:{method:()=>null},J:{here:()=>({scene:'s1',shot:'sh1'}),setAgent(){}},P:{},T:{},structuredClone});
 return vm.runInContext(`${source}\n;({answer,contextOf,pin,here})`,context);
}
test('actual resolver applies Book notes by explicit scope and scene ownership without sibling bleed',async()=>{
 const I=native();
 const explicit=await I.answer(await I.contextOf('book:film'));
 assert.ok(explicit.refs.includes('instruction:note0@1'));assert.ok(!explicit.refs.includes('instruction:note1@1'));
 const scene=await I.answer(await I.contextOf('shot:s1/sh1'));
 assert.deepEqual(plain(scene.refs.filter(r=>r.startsWith('instruction:'))),['instruction:note0@1','instruction:note2@1']);
 const elsewhere=await I.answer({...I.here(),scene:'s2',shot:'sh2'});
 assert.ok(!elsewhere.refs.some(r=>r.startsWith('instruction:note')));
});
test('actual queue pin carries newly applicable Book instructions with the native shot context',async()=>{
 const I=native();await I.answer(I.here());
 const workflow={nodes:[],extra:{snap:{bricks:[]}}},pinned=I.pin(workflow);
 assert.ok(pinned.extra.snap.instructions.refs.includes('instruction:note0@1'));
 assert.ok(!pinned.extra.snap.instructions.refs.includes('instruction:note1@1'));
 assert.equal(pinned.extra.snap.instructions.context.scene,'s1');
 assert.equal(workflow.extra.snap.instructions,undefined);
});

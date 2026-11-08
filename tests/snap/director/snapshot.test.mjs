import test from 'node:test';import assert from 'node:assert/strict';import { harness } from './host-fixture.mjs';
test('snapshot pins story/world versions, hashes scenes and includes only accepted state',async()=>{
 const h=harness(),s=await h.host.snapshot({book:'book:film'});assert.equal(s.book.story.ref,'story:film@1');assert.equal(s.units[0].cut,'C1');assert.equal(s.provenance.scenes[0].sha256.length,64);assert.equal(s.cast[0].ref,'cast:a@1');
});
test('scene/shot target infers its Book and rejects mismatched ownership',async()=>{
 const h=harness();assert.equal((await h.host.snapshot({scene:'s1',shot:'sh1'})).book.ref,'book:film@1');
 await assert.rejects(h.host.snapshot({shot:'sh1'}),/scene/);await assert.rejects(h.host.snapshot({scene:'s1',shot:'unknown'}),/not in/);
 h.put('book','other',{name:'Other',scenes:['s1']});await assert.rejects(h.host.snapshot({book:'book:other',scene:'s1'}),/different Book/);
});
test('path traversal, historical Book and missing stable cut ids are refused',async()=>{
 const h=harness();await assert.rejects(h.host.snapshot({scene:'../secrets'}),/not a path/);
 h.records.get('book:film').head=2;await assert.rejects(h.host.snapshot({book:'book:film@1'}),/historical/);h.records.get('book:film').head=1;
 delete h.scenes.get('s1').shots[0].unit.cut;await assert.rejects(h.host.snapshot({book:'book:film'}),/stable cut/);
});
test('missing references remain visible instead of quietly substituted',async()=>{
 const h=harness();h.records.delete('cast:a');h.records.delete('story:film');const s=await h.host.snapshot({book:'book:film'});assert.equal(s.cast[0].missing,true);assert.ok(s.errors.some(e=>e.code==='STORY_MISSING'));
});
test('failed/still source and source from another Book are rejected',async()=>{
 const h=harness();h.takes.get('take-original').media=[{kind:'image',filename:'a.png'}];await assert.rejects(h.host.snapshot({source_take:'take-original'}),/video take/);
 h.takes.get('take-original').media=[{kind:'video',filename:'a.mp4'}];h.put('book','other',{name:'Other',scenes:[]});await assert.rejects(h.host.snapshot({book:'book:other',source_take:'take-original'}),/different Book/);
});
test('story projection follows native current-head semantics, while a pinned look remains pinned',async()=>{
 const h=harness();h.records.get('book:film').versions[0].body.story='story:film@1';h.records.get('book:film').versions[0].body.style='look:film@1';
 const st=h.records.get('story:film');st.versions.push({n:2,hash:'new-story',body:{beats:[],groups:[]}});st.head=2;
 const look=h.records.get('look:film');look.versions.push({n:2,hash:'new-look',body:{name:'Other'}});look.head=2;
 const s=await h.host.snapshot({book:'book:film'});assert.equal(s.book.story.ref,'story:film@2');assert.equal(s.book.style_ref,'look:film@1');
});

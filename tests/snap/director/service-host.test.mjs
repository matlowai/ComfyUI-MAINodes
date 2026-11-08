import test from 'node:test';import assert from 'node:assert/strict';
import { createNativeHost } from '../../../web/snap/director/host.mjs';
import { harness } from './host-fixture.mjs';
const writes=h=>h.events.filter(e=>['save','propose'].includes(e[0]));
test('real native host reads catalogue, records and scoped instructions without persistence',async()=>{
 const h=harness();const p=await h.call('plan_strategy',{strategy:'script-to-film@1.0.0',book:'book:film'});
 assert.ok(p.ok,JSON.stringify(p.errors));assert.equal(writes(h).length,0);assert.equal(h.records.has('production:of-film'),false);
 assert.ok(h.events.some(e=>e[0]==='read'&&e[1]==='snap/scenes/s1.json'));
 assert.ok(h.events.some(e=>e[0]==='instructions'&&e[1].book==='film'&&e[1].shot==='sh1'));
});
test('factory is safe during native tool-table initialization',()=>{
 const h=harness();let touched=false;createNativeHost({...h.dependencies,getTools:()=>{touched=true;throw new Error('TDZ');}});assert.equal(touched,false);
});
test('full dialogue plan respects actual per-tool scoped preferences from production host',async()=>{
 const h=harness();h.preferences([h.note({candidate_count:4},'tool:make_board','person')]);const p=await h.call('plan_strategy',{strategy:'dialogue-director@1.0.0',book:'book:film'});
 assert.equal(p.operations.find(t=>t.tool==='make_board').args.count,4);assert.equal(p.operations.filter(t=>t.tool==='run').length,2);assert.equal(writes(h).length,0);
});
test('preview never creates or rewrites absent Book/scene state',async()=>{
 const h=harness();const p=await h.call('plan_strategy',{strategy:'script-to-film@1.0.0',inputs:{name:'New'}});
 assert.equal(writes(h).length,0);assert.equal(p.operations.find(t=>t.tool==='create_book').args.name,'New');assert.equal(h.records.size,5);
});
test('immutable variant dry-run, native proposal, confirmed save and dedup use existing records',async()=>{
 const h=harness();const base=await h.call('describe_strategy',{strategy:'script-to-film@1.0.0'});const definition=structuredClone(base.definition);definition.id='my-film';definition.name='My Film';definition.parameters.candidate_count=3;
 const args={base:base.ref,expected_base_sha256:base.definition_sha256,definition};
 const dry=await h.call('save_strategy_variant',{...args,dry_run:true});assert.equal(writes(h).length,0);
 const proposed=await h.call('save_strategy_variant',args);assert.equal(proposed.proposed,'p1');assert.equal(h.events.filter(e=>e[0]==='save').length,0);
 const saved=await h.call('save_strategy_variant',args,{confirmed:true});assert.ok(saved.ref.startsWith('card:director-'));assert.equal(saved.ref,`${dry.ref}@1`);
 const again=await h.call('save_strategy_variant',args,{confirmed:true});assert.equal(again.made,false);
 const read=await h.call('describe_strategy',{strategy:saved.ref});assert.equal(read.definition.parameters.candidate_count,3);
 assert.equal(base.definition.parameters.candidate_count,2);
});
test('variant save refuses stale base, implicit inheritance and same-id release replacement',async()=>{
 const h=harness(),base=await h.call('describe_strategy',{strategy:'script-to-film@1.0.0'});
 const args={base:base.ref,expected_base_sha256:'0'.repeat(64),definition:base.definition};await assert.rejects(h.call('save_strategy_variant',args),/Re-read/);
 args.expected_base_sha256=base.definition_sha256;await assert.rejects(h.call('save_strategy_variant',args),/distinct id/);
 args.definition={...base.definition,id:'mine',extends:'pack:script-to-film@1.0.0'};await assert.rejects(h.call('save_strategy_variant',args),/without extends/);assert.equal(writes(h).length,0);
});
test('scoped parameter note is inspectable and not automatically saved or activated',async()=>{
 const h=harness(),out=await h.call('strategy_parameter_note',{strategy:'script-to-film@1.0.0',scope:'book:film',parameters:{candidate_count:1},instruction:'instruction:old'});
 assert.equal(writes(h).length,0);assert.equal(out.tool,'save_instruction');assert.equal(out.args.id,'instruction:old');assert.equal(out.args.source.snap_director.definition_sha256.length,64);
});
test('variant hash collision or archived variant is refused instead of overwrite/revival',async()=>{
 const h=harness();h.put('card','director-test',{different:true});await assert.rejects(h.host.saveCard('director-test',{kind:'production_strategy'}),/different data/);
 h.records.get('card:director-test').archived='archived';await assert.rejects(h.host.saveCard('director-test',{different:true}),/archived/);assert.equal(writes(h).length,0);
});
test('source takes enforce account/vault access while allowing private owner work',async()=>{
 const h=harness();h.private(true);let p=await h.call('plan_strategy',{strategy:'transform-footage@1.0.0',source_take:'take-original',inputs:{change:'Relight'}});assert.ok(p.ok);assert.equal(writes(h).length,0);
 h.above(true);await assert.rejects(h.call('plan_strategy',{strategy:'transform-footage@1.0.0',source_take:'take-original'}),/missing, locked/);h.above(false);
 h.takes.get('take-original').kept_encrypted=true;h.takes.get('take-original').locked=true;await assert.rejects(h.call('plan_strategy',{strategy:'transform-footage@1.0.0',source_take:'take-original'}),/missing, locked/);assert.ok(h.events.some(e=>e[0]==='reopen'));
});
test('catalogue rejects external origins and retries a transient read without writes',async()=>{
 const h=harness(),foreign=createNativeHost({...h.dependencies,catalogueURL:'https://elsewhere.invalid/x.json'});await assert.rejects(foreign.registryEntries(),/this SNAP installation/);
 h.catalogueResponse({ok:false,status:503});await assert.rejects(h.host.registryEntries(),/503/);h.catalogueResponse(null);assert.equal((await h.host.registryEntries()).length,8);
});
test('missing/unreadable personalised method registry never silently substitutes pack settings',async()=>{
 const h=harness();h.methodProblem('User registry unreadable (500)');await assert.rejects(h.call('plan_strategy',{strategy:'script-to-film@1.0.0'}),/unreadable/);
});
test('fresh scene reads are not replaced by cached scene objects across previews',async()=>{
 const h=harness(),q={strategy:'script-to-film@1.0.0',book:'book:film'};const a=await h.call('plan_strategy',q);
 h.scenes.get('s1').shots[0].active='take-original';const b=await h.call('plan_strategy',q);assert.notEqual(a.plan_sha256,b.plan_sha256);assert.equal(b.operations.filter(t=>t.tool==='run').length,0);
});
test('selected and inherited board methods receive their own notes without sibling leakage',async()=>{
 const h=harness(),second=structuredClone(h.scenes.get('s1').shots[0]);second.id='sh2';second.unit.cut='C2';h.scenes.get('s1').shots.push(second);
 h.preferences([h.note({view_method:'qwen21_view'},'shot:s1/sh1','shot'),h.note({candidate_count:4},'method:qwen21_view','person','instruction:qwen@1'),h.note({candidate_count:3},'method:ph3_view','person','instruction:ph3@1')]);
 const p=await h.call('plan_strategy',{strategy:'script-to-film@1.0.0',book:'book:film'});
 assert.ok(p.ok,JSON.stringify(p.errors));assert.deepEqual(p.operations.filter(o=>o.tool==='make_board').map(o=>o.args.count),[4,3]);
 assert.deepEqual(p.tool_parameters['s1/sh1:make_board'].instructions.context.methods,['qwen21_view']);
 assert.deepEqual(p.tool_parameters['s1/sh2:make_board'].instructions.context.methods,['ph3_view']);
 assert.equal(p.operations.filter(o=>o.tool==='run').length,4);
});
test('recast and explicit upscale method notes use the actual planned method',async()=>{
 const h=harness();h.preferences([h.note({candidate_count:5},'method:remake_swap','person'),h.note({upscale:false},'method:stage2','person','instruction:up@1')]);
 const p=await h.call('plan_strategy',{strategy:'transform-footage@1.0.0',source_take:'take-original',parameters:{edit_mode:'recast'},inputs:{who:'A',becomes:'B'}});
 assert.ok(p.ok,JSON.stringify(p.errors));assert.deepEqual(p.operations.filter(o=>o.tool==='edit_take').map(o=>o.args.count),[3,2]);
 const q=await h.call('plan_strategy',{strategy:'transform-footage@1.0.0',source_take:'take-original',parameters:{upscale_method:'stage2'},inputs:{change:'A blue jacket'}});
 assert.deepEqual(q.tool_parameters.upscale_take.instructions.context.methods,['stage2']);
 assert.equal(q.operations.filter(o=>o.tool==='upscale_take').length,0);
});
test('method-directed choices resolve when stable and report actual cycles',async()=>{
 const h=harness();h.preferences([h.note({view_method:'qwen21_view'},'method:ph3_view','person'),h.note({view_method:'qwen21_view'},'method:qwen21_view','person','instruction:qwen@1')]);
 const request={strategy:'script-to-film@1.0.0',book:'book:film'},p=await h.call('plan_strategy',request);
 assert.ok(p.ok,JSON.stringify(p.errors));assert.equal(p.operations.find(o=>o.tool==='make_board').args.method,'qwen21_view');
 h.preferences([h.note({view_method:'qwen21_view'},'method:ph3_view','person'),h.note({view_method:'ph3_view'},'method:qwen21_view','person','instruction:qwen@1')]);
 await assert.rejects(h.call('plan_strategy',request),error=>error.code==='METHOD_SCOPE_CYCLE');
});
test('unused board stages do not resolve unrelated method cycles in a Book',async()=>{
 const h=harness();h.preferences([h.note({view_method:'qwen21_view'},'method:ph3_view','person'),h.note({view_method:'ph3_view'},'method:qwen21_view','person','instruction:qwen@1')]);
 const request={strategy:'transform-footage@1.0.0',source_take:'take-original',inputs:{change:'A blue jacket'}};
 assert.ok((await h.call('plan_strategy',request)).ok);
 const p=await h.call('plan_strategy',{...request,book:'book:film'});
 assert.ok(p.ok,JSON.stringify(p.errors));assert.equal(p.operations.some(o=>o.tool==='make_board'),false);
 assert.equal(p.operations.filter(o=>o.tool==='edit_take').length,1);
 const base=await h.call('describe_strategy',{strategy:'script-to-film@1.0.0'}),definition=structuredClone(base.definition);
 definition.id='no-boards';definition.stages.find(s=>s.kind==='boards').enabled=false;
 h.put('card','no-boards',{kind:'production_strategy',strategy:definition});
 const disabled=await h.call('plan_strategy',{strategy:'card:no-boards@1',book:'book:film'});
 assert.ok(disabled.ok,JSON.stringify(disabled.errors));assert.equal(disabled.operations.some(o=>o.tool==='make_board'),false);
});
test('an explicit upscale-off choice does not resolve its unused method cycle',async()=>{
 const h=harness();h.preferences([h.note({upscale_method:'stage2'},'global','person'),h.note({upscale_method:'inherit'},'method:stage2','person','instruction:up@1')]);
 const p=await h.call('plan_strategy',{strategy:'transform-footage@1.0.0',source_take:'take-original',parameters:{upscale:false},inputs:{change:'A blue jacket'}});
 assert.ok(p.ok,JSON.stringify(p.errors));assert.equal(p.operations.some(o=>o.tool==='upscale_take'),false);
 assert.deepEqual(p.tool_parameters.upscale_take.instructions.context.methods,[]);
});

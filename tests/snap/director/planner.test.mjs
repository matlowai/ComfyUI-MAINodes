import test from 'node:test'; import assert from 'node:assert/strict';
import { compilePlan } from '../../../web/snap/director/planner.mjs';
import { registry,snapshot,emptySnapshot,tools,methods,instructionStack,parameterNote,freeze } from './fixtures.mjs';
const plan=(request={},data=snapshot(),rest={})=>compilePlan({resolved:registry().resolve(request.strategy??'script-to-film@1.0.0'),snapshot:data,request:{strategy:'script-to-film@1.0.0',...request},tools,methods,instructions:instructionStack(),...rest});
const stage=(p,k)=>p.stages.find(s=>s.kind===k),ops=(p,name)=>p.operations.filter(t=>t.tool===name);
test('film plan is pure, reproducible, native and reuses selected work conditionally',async()=>{
 const data=freeze(snapshot()),r=freeze({strategy:'script-to-film@1.0.0',book:'book:film'});const a=await plan(r,data),b=await plan(r,data);
 assert.equal(a.plan_sha256,b.plan_sha256);assert.ok(a.ok,JSON.stringify(a.errors));assert.equal(a.mutates,false);assert.equal(a.executes,false);
 assert.equal(ops(a,'create_book').length,0);assert.ok(stage(a,'boards').reuses.length);assert.ok(stage(a,'generate').reuses.length);
 assert.equal(ops(a,'run').length,2);assert.equal(ops(a,'new_seed').length,1);assert.ok(a.counts.unresolved_calls>0);assert.equal(a.costs.gpu_seconds,null);
 for(const call of a.operations)assert.ok(call.contract.exists);
});
test('new production creates native Book and keeps story decisions unresolved, not invented',async()=>{
 const p=await plan({inputs:{name:'Synthetic short',fountain:'INT. ROOM - DAY\n\nA opens a box.'}},emptySnapshot());
 assert.ok(p.ok);assert.equal(ops(p,'create_book')[0].args.name,'Synthetic short');assert.equal(ops(p,'import_fountain')[0].args.text,'INT. ROOM - DAY\n\nA opens a box.');
 assert.ok(ops(p,'import_fountain')[0].bindings.book);assert.equal(ops(p,'run').length,0);
 assert.ok(stage(p,'coverage').preconditions.some(x=>x.code==='REPLAN_AFTER_STORY_IMPORT'));
});
test('missing primary Cast picture produces a preparation gap, not an invalid sheet call',async()=>{
 const s=snapshot();s.cast[0].refs=[];const p=await plan({},s);assert.ok(stage(p,'assets').preconditions.some(x=>x.code==='CAST_REFERENCE_REQUIRED'));assert.equal(ops(p,'make_character_sheet').length,0);
});
test('shot and tool scoped preferences apply without leaking to a sibling cut',async()=>{
 const s=snapshot();for(const u of s.units){u.board=null;u.active=null;}
 const p=await plan({},s,{scopedInstructions:{'s1/sh1':instructionStack(parameterNote({candidate_count:1},'shot:s1/sh1','shot')),'s1/sh2':instructionStack(parameterNote({candidate_count:3},'shot:s1/sh2','shot'))},toolInstructions:{'s1/sh1:make_board':instructionStack(parameterNote({candidate_count:4},'tool:make_board','person'))}});
 assert.ok(p.ok);assert.equal(ops(p,'make_board')[0].args.count,4);assert.equal(ops(p,'make_board')[1].args.count,3);assert.equal(ops(p,'run').length,4);
});
test('native tool mismatch changes both errors and fingerprint, instead of disappearing',async()=>{
 const a=await plan(),b=await plan({},snapshot(),{tools:tools.filter(t=>t.name!=='make_board')});assert.equal(b.ok,false);assert.notEqual(a.plan_sha256,b.plan_sha256);assert.ok(b.errors.some(e=>e.code==='NATIVE_CONTRACT_MISMATCH'));
});
test('continuation dependencies are explicit and circular cuts fail without reordering canon',async()=>{
 const s=snapshot();s.units[0].opens_on={cut:'C2'};const p=await plan({},s);assert.equal(p.ok,false);assert.ok(p.errors.some(e=>e.code==='CUT_DEPENDENCY_ERROR'));
 const q=await plan({parameters:{continuation:'none'}});assert.ok(stage(q,'generate').preconditions.some(e=>e.code==='CONTINUATION_CONFLICT'));
});
test('dialogue route reuses voices only for the inspected speaking scope',async()=>{
 const s=snapshot();s.target.scene='s1';s.target.shot='sh1';s.units=s.units.slice(0,1);const p=await plan({strategy:'dialogue-director@1.0.0'},s);
 assert.deepEqual(stage(p,'voices').reuses.map(r=>r.ref),['cast:a@1']);assert.equal(ops(p,'check_voice').length,1);
});
test('edit count batches respect native maximum, wait before inspection and preserve source',async()=>{
 const s=emptySnapshot();s.source_take={id:'take-original',status:'success',media:[{kind:'video'}]};const p=await plan({strategy:'transform-footage@1.0.0',source_take:'take-original',parameters:{candidate_count:8},inputs:{change:'Change only the jacket colour.'}},s);
 assert.ok(p.ok,JSON.stringify(p.errors));assert.deepEqual(ops(p,'edit_take').map(t=>t.args.count),[3,3,2]);for(const t of ops(p,'edit_take'))assert.equal(t.args.take,'take-original');
 for(const inspect of ops(p,'candidate_frames'))assert.ok(p.operations.some(t=>t.id===inspect.after[0]&&t.tool==='wait_for'&&t.args.until==='waiting'));
 assert.equal(ops(p,'apply_candidate').length,1);assert.equal(ops(p,'export_cut').length,0);
});
test('range and mask requests never silently become whole-video edits',async()=>{
 const p=await plan({strategy:'transform-footage@1.0.0',inputs:{change:'Relight',source_range:{start_frame:2,end_frame:20}}},emptySnapshot());assert.equal(p.ok,false);assert.equal(ops(p,'edit_take').length,0);assert.ok(p.errors.some(e=>e.code==='TEMPORAL_EDIT_CAPABILITY_GAP'));
});
test('recast requires actual who/becomes and never invents source identity',async()=>{
 const p=await plan({strategy:'transform-footage@1.0.0',parameters:{edit_mode:'recast'}},emptySnapshot());assert.ok(p.ok);const e=ops(p,'edit_take')[0];assert.equal(e.args.method,'remake_swap');assert.ok(e.bindings.who&&e.bindings.becomes&&e.bindings.take);assert.equal(e.arguments_complete,false);
});
test('packing proposals map only known beats and do not replace existing cut identities',async()=>{
 const s=snapshot();s.units=[];const p=await plan({packing:{beats:[{id:'b1',duration_s:3},{id:'b2',duration_s:3}],limits:{fps:24,min_seconds:3,max_seconds:10}}},s);
 assert.ok(p.ok,JSON.stringify(p.errors));assert.deepEqual(ops(p,'add_cut')[0].args.beats,['b1','b2']);assert.equal(ops(p,'add_cut')[0].args.seconds,6);
 const q=await plan({packing:{beats:[{id:'b1',duration_s:3}],limits:{fps:24,min_seconds:3,max_seconds:10}}});assert.equal(ops(q,'add_cut').length,0);
});
test('draft strategies and permission-changing operations are not silently executable',async()=>{
 await assert.rejects(plan({strategy:'action-continuity@0.1.0'}),/design example/);
 const resolved=registry().resolve('script-to-film@1.0.0');resolved.definition.stages=[{id:'bad',kind:'operations',operations:[{tool:'set_agent_permissions',args:{run:true}}]}];
 const p=await plan({},snapshot(),{resolved});assert.equal(p.ok,false);assert.equal(p.operations[0].arguments_complete,false);assert.ok(p.errors.some(e=>e.code==='OUTSIDE_STRATEGY_AUTHORITY'));
});
test('supplied screenplay and candidate values pass through beyond former policy caps',async()=>{
 const text='An unabridged screenplay.\n'.repeat(10000);
 const p=await plan({inputs:{name:'A'.repeat(161),fountain:text},parameters:{candidate_count:9}},emptySnapshot());
 assert.ok(p.ok,JSON.stringify(p.errors));assert.equal(ops(p,'import_fountain')[0].args.text,text);
 const s=snapshot();s.units=s.units.slice(0,1);s.units[0].active=null;
 assert.equal(ops(await plan({parameters:{candidate_count:9}},s),'run').length,9);
});

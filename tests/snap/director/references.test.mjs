import test from 'node:test'; import assert from 'node:assert/strict';
import { compileReferences, bindPrompt } from '../../../web/snap/director/references.mjs';
import { referenceRequest, freeze } from './fixtures.mjs';
const code=(r,c)=>r.errors.some(e=>e.code===c);
const extra=(q,id,roles,more={})=>q.references.push({id,media:'image',roles,source:{ref:`test:${id}@1`},...more});
test('reference roles separate review evidence from conditioning and bind semantic ids deterministically',()=>{
  const q=freeze(referenceRequest()),out=compileReferences(q);assert.ok(out.ok);assert.equal(out.coverage.metadata_complete,true);assert.equal(out.coverage.visually_verified,false);
  assert.deepEqual(out.generation.map(r=>r.id),['camera','actor','voice']);assert.equal(out.review.length,5);
  assert.equal(out.prompt,'Keep the framing of <Picture 1> and the identity in <Picture 2>.');
});
test('crops and repeated camera views do not create side coverage',()=>{
  const q=referenceRequest();q.references[1].derived_from_viewpoint='east';assert.ok(code(compileReferences(q),'SCENE_COVERAGE_INCOMPLETE'));
  q.context.ablation=true;q.context.ablation_reason='Deliberate isolated geometry study';assert.ok(compileReferences(q).ok);
  delete q.context.ablation_reason;assert.ok(code(compileReferences(q),'ABLATION_REASON_REQUIRED'));
});
test('unapproved or wrong-scene elevations do not qualify as coverage',()=>{
  const q=referenceRequest();q.references[1].approved=false;assert.ok(code(compileReferences(q),'SCENE_COVERAGE_INCOMPLETE'));
  q.references[1].approved=true;q.references[1].scene='elsewhere';assert.ok(code(compileReferences(q),'SCENE_COVERAGE_INCOMPLETE'));
});
test('explicit and authoritative geometry contradictions remain errors',()=>{
  const q=referenceRequest();q.context.geometry_conflicts=[{refs:['top','side'],observation:'Footprints disagree'}];assert.ok(code(compileReferences(q),'GEOMETRY_CONFLICT'));
  q.context.geometry_conflicts=[];q.references[0].authoritative=true;q.references[0].geometry_revision='r1';q.references[1].authoritative=true;q.references[1].geometry_revision='r2';assert.ok(code(compileReferences(q),'AUTHORITATIVE_GEOMETRY_CONFLICT'));
});
test('non-speaking voice and action peaks stay out; required omissions are failures',()=>{
  const q=referenceRequest();q.context.speakers=[];extra(q,'peak',['action_key']);const out=compileReferences(q);
  assert.ok(out.exclusions.some(r=>r.code==='NON_SPEAKING_VOICE'));assert.ok(out.exclusions.some(r=>r.code==='ACTION_KEY_TARGET'));
  q.references.at(-1).required=true;assert.ok(code(compileReferences(q),'REQUIRED_REFERENCE_EXCLUDED'));
  q.context.hold=true;assert.ok(compileReferences(q).generation.some(r=>r.id==='peak'));
});
test('opening-frame continuation excludes conflicting scene conditioning',()=>{
  const q=referenceRequest();q.context.continuation='same_camera';delete q.prompt;assert.ok(code(compileReferences(q),'OPENING_FRAME_MISSING'));
  extra(q,'opening',['opening_frame']);const out=compileReferences(q);assert.ok(out.ok);assert.equal(out.generation[0].id,'opening');assert.ok(!out.generation.some(r=>r.id==='camera'));
});
test('master and critic evidence do not silently enter conditioning',()=>{
  const q=referenceRequest();extra(q,'master',['location_master']);extra(q,'judge',['critic_reference']);const out=compileReferences(q);
  assert.ok(out.exclusions.some(r=>r.code==='MASTER_WITH_PLATE'));assert.ok(out.exclusions.some(r=>r.code==='CRITIC_ONLY'));
});
test('budgets preserve authored order after priority selection and expose all omissions',()=>{
  const q=referenceRequest();delete q.prompt;q.profile.limits.image=1;q.references.find(r=>r.id==='actor').priority=8;
  let out=compileReferences(q);assert.equal(out.generation[0].id,'actor');assert.ok(out.exclusions.some(r=>r.id==='camera'&&r.code==='REFERENCE_BUDGET'));
  q.references.find(r=>r.id==='camera').required=true;q.references.find(r=>r.id==='actor').required=true;assert.ok(code(compileReferences(q),'REQUIRED_REFERENCE_EXCLUDED'));
});
test('partial initialization requires a single declared canvas and explicit method support',()=>{
  const q=referenceRequest();q.context.denoise=0.7;assert.ok(code(compileReferences(q),'PARTIAL_INIT_UNSUPPORTED'));q.profile.partial_init_supported=true;
  assert.ok(code(compileReferences(q),'INIT_CANVAS_MISSING'));q.profile.first_image_role='edit_canvas';extra(q,'canvas',['edit_canvas']);
  let out=compileReferences(q);assert.ok(out.ok);assert.equal(out.generation[0].id,'canvas');extra(q,'canvas2',['edit_canvas']);assert.ok(code(compileReferences(q),'FIRST_IMAGE_AMBIGUOUS'));
});
test('semantic binding rejects raw tags, excluded references, unknown and hostile placeholders',()=>{
  assert.throws(()=>bindPrompt('copy <Picture 1>',{}),/hard-coded/);assert.throws(()=>bindPrompt('{{ref:nope}}',{}),/missing/);
  assert.throws(()=>bindPrompt('{{something}}',{}),/Only exact/);assert.throws(()=>bindPrompt('{{ref:__proto__}}',{}),/missing/);
  const q=referenceRequest();q.prompt='copy {{ref:top}}';assert.ok(code(compileReferences(q),'UNBOUND_REFERENCE'));
});
test('duplicate ids, role/media mismatch and ambiguous tag descriptors fail',()=>{
  const q=referenceRequest();q.references.push(structuredClone(q.references[0]));assert.throws(()=>compileReferences(q),/twice/);q.references.pop();
  q.references[0].media='audio';assert.ok(code(compileReferences(q),'ROLE_MEDIA_MISMATCH'));q.references[0].media='image';
  q.profile.tags.audio='<Picture {n}>';assert.ok(code(compileReferences(q),'AMBIGUOUS_REFERENCE_TAG'));
});
test('identical physical inputs warn rather than being silently removed',()=>{
  const q=referenceRequest();delete q.prompt;extra(q,'same-actor',['cast_identity'],{source:structuredClone(q.references.find(r=>r.id==='actor').source)});
  const out=compileReferences(q);assert.ok(out.generation.some(r=>r.id==='same-actor'));assert.ok(out.warnings.some(r=>r.code==='DUPLICATE_SOURCE'));
});
test('reserved dictionary reference ids are rejected before constructing bindings',()=>{
 const q=referenceRequest();q.references[0].id='constructor';assert.throws(()=>compileReferences(q),/non-reserved/);
});
test('caller-declared budgets and priorities have no arbitrary packet ceiling',()=>{
 const q=referenceRequest();delete q.prompt;q.profile.limits={image:257,video:0,audio:0};q.context={};
 q.references=Array.from({length:257},(_,i)=>({id:`picture${i}`,media:'image',roles:['cast_identity'],source:{ref:`cast:person${i}@1`},priority:-2000}));
 const out=compileReferences(q);assert.ok(out.ok,JSON.stringify(out.errors));assert.equal(out.generation.length,257);assert.equal(out.exclusions.length,0);
});
test('a zero conditioning budget cannot silently drop the required initialization canvas',()=>{
 const q=referenceRequest();delete q.prompt;q.profile.limits.image=0;q.profile.partial_init_supported=true;q.profile.first_image_role='edit_canvas';q.context.denoise=.7;
 extra(q,'canvas',['edit_canvas']);const out=compileReferences(q);
 assert.equal(out.ok,false);assert.ok(code(out,'FIRST_IMAGE_EXCLUDED'));assert.equal(out.generation.filter(r=>r.media==='image').length,0);
});

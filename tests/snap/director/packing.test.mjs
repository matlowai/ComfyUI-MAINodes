import test from 'node:test';
import assert from 'node:assert/strict';
import { packShots, frameRate } from '../../../web/snap/director/packing.mjs';
import { freeze } from './fixtures.mjs';
const limits = { fps: 24, min_seconds: 2, max_seconds: 10 };
const input = (...durations) => ({ beats: durations.map((duration_s, i) => ({ id: `b${i}`, duration_s })), limits });
test('packing preserves every beat, uses integer frames and never mutates frozen inputs', () => {
  const q = freeze(input(1, 2, 3, 4)); const out = packShots(q);
  assert.ok(out.ok); assert.ok(out.alternatives.length > 1);
  for (const a of out.alternatives) {
    assert.deepEqual(a.segments.flatMap(s => s.beat_ids), q.beats.map(b => b.id));
    assert.equal(a.total_frames, a.segments.reduce((n,s) => n+s.render_frames,0));
    for (const s of a.segments) { assert.ok(Number.isInteger(s.render_frames)); assert.ok(s.render_frames >= s.content_frames); assert.ok(s.render_seconds <= 10); }
  }
});
test('speech floor, visible padding and supplied estimates are not shortened', () => {
  const out=packShots({beats:[{id:'spoken',duration_s:1,speech_s:3}],limits:{...limits,min_seconds:5}});
  assert.equal(out.alternatives[0].segments[0].render_frames,120);
  assert.equal(out.alternatives[0].segments[0].content_frames,72);
  assert.equal(out.alternatives[0].segments[0].padding_frames,48);
  assert.ok(out.warnings.some(x=>x.code==='SPEECH_FLOOR'));
});
test('rational fps and offset grids round upward without clipping content', () => {
  const out=packShots({beats:[{id:'b',duration_s:2.1}],limits:{fps:{num:24000,den:1001},min_seconds:1,max_seconds:5,frame_step:8,frame_offset:1}});
  const s=out.alternatives[0].segments[0]; assert.equal((s.render_frames-1)%8,0); assert.ok(s.render_seconds>=2.1);
});
test('overlong atomic beat is an explicit failure, not silently split', () => {
  const out=packShots(input(12));assert.equal(out.ok,false);assert.equal(out.alternatives.length,0);assert.equal(out.errors[0].code,'BEAT_TOO_LONG');
});
test('hard scene/camera boundaries and intentional joins are preserved', () => {
  const q=input(1,1,1);q.beats[0].join_next=true;q.beats[1].scene='one';q.beats[2].scene='two';
  const out=packShots(q);for(const a of out.alternatives)assert.deepEqual(a.segments.map(s=>s.beat_ids),[['b0','b1'],['b2']]);
  q.beats[0].camera='a';q.beats[1].camera='b';assert.throws(()=>packShots(q),/must join/);
});
test('illegal inputs, invalid fps and infeasible frame grids fail visibly', () => {
  assert.throws(()=>packShots({...input(1),limits:{...limits,frame_step:8,frame_offset:8}}),/offset/);
  assert.throws(()=>packShots({...input(1),limits:{...limits,min_seconds:20}}),/bounds/);
  for(const fps of [0,-1,NaN,Infinity,{num:24,den:0},{num:24,den:1,extra:1}])assert.throws(()=>frameRate(fps));
  const q=input(1);q.beats[0].join_next=true;assert.throws(()=>packShots(q),/nonexistent/);
  const out=packShots({beats:[{id:'b',duration_s:1}],limits:{fps:1,min_seconds:1,max_seconds:2,frame_step:8,frame_offset:0}});assert.equal(out.ok,false);
});
test('caller-supplied frame rates and beat counts have no arbitrary planning ceiling', () => {
  assert.equal(frameRate(480).value,480);
  const beats=Array.from({length:257},(_,i)=>({id:`b${i}`,duration_s:1,break_after:true}));
  const out=packShots({beats,limits:{fps:480,min_seconds:1,max_seconds:1}});
  assert.ok(out.ok);assert.equal(out.alternatives[0].segments.length,257);
});
test('empty input is an explicitly empty plan and duplicate ids are rejected', () => {
  assert.deepEqual(packShots(input()).alternatives[0].segments,[]);
  const q=input(1,2);q.beats[1].id='b0';assert.throws(()=>packShots(q),/once/);
});
test('top-K dynamic program matches independent exhaustive enumeration on 120 small cases', () => {
  // Independent oracle: integer seconds at 1 fps, zero semantic boundary costs; enumerate every partition.
  let seed=19;const rng=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
  for(let trial=0;trial<120;trial++) {
    const ds=Array.from({length:1+Math.floor(rng()*7)},()=>1+Math.floor(rng()*4));
    const q={beats:ds.map((duration_s,i)=>({id:`b${i}`,duration_s})),limits:{fps:1,min_seconds:3,max_seconds:8},preferred_seconds:6,alternatives:5};
    const candidates=[];
    function walk(start,bounds,score) {
      if(start===ds.length){candidates.push({bounds,score:Number(score.toFixed(9))});return;}
      let total=0;for(let end=start;end<ds.length;end++){total+=ds[end];if(total>8)break;const dur=Math.max(3,total);walk(end+1,[...bounds,end],score+1+2*(dur-total)+0.1*Math.abs(dur-6));}
    }
    walk(0,[],0);const cmp=(a,b)=>{for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]-b[i];return a.length-b.length;};
    candidates.sort((a,b)=>a.score-b.score||a.bounds.length-b.bounds.length||cmp(a.bounds,b.bounds));
    const got=packShots(q).alternatives.map(a=>({bounds:a.boundaries,score:a.score}));assert.deepEqual(got,candidates.slice(0,5),`trial ${trial}`);
  }
});

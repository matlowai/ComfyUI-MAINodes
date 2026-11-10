import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../web/snap/live_preview.js',import.meta.url),'utf8');
const {createLivePreviews}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('live frame lifecycle and execution isolation',()=>{
 let serial=0;const revoked=[];
 const live=createLivePreviews(d=>d.jobId==='foreign'?null:{brick:d.nodeId,graph:'current',job:d.jobId,stage:'Sampler'}, {createURL:()=>`frame-${++serial}`,revokeURL:s=>revoked.push(s)});
 assert.equal(live.accept({jobId:'foreign',nodeId:'render',blob:{}}),null);
 assert.equal(serial,0);
 live.accept({jobId:'a',nodeId:'render',blob:{}});assert.equal(live.get('render','other'),null);assert.equal(live.get('render','current').src,'frame-1');
 live.accept({jobId:'a',nodeId:'render',blob:{}});assert.deepEqual(revoked,['frame-1']);assert.equal(live.get('render','current').src,'frame-2');
 live.accept({jobId:'b',nodeId:'upscale',blob:{}});assert.equal(live.get('render','current'),null);assert.ok(revoked.includes('frame-2'));
 live.clear('a');assert.ok(live.get('upscale','current'));
 live.clear('b');assert.equal(live.get('upscale','current'),null);assert.ok(revoked.includes('frame-3'));
});

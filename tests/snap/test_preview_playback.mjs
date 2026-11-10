import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const s=await readFile(new URL('../../web/snap/preview_playback.js',import.meta.url),'utf8');
const {playPreview,pausePreview}=await import(`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`);
const video=(width,height,readyState=1)=>({videoWidth:width,videoHeight:height,readyState,dataset:{},plays:0,pauses:0,play(){this.plays++;return Promise.resolve();},pause(){this.pauses++;}});
test('large outputs are manually playable without automatic decoding',()=>{const v=video(6144,2048);playPreview(v);assert.equal(v.plays,0);assert.equal(v.controls,true);assert.equal(v.dataset.previewPlayback,'manual');});
test('metadata is required before preview autoplay and hover cancellation stays cancelled',()=>{const v=video(1536,512,0);playPreview(v);assert.equal(v.plays,0);pausePreview(v);v.onloadedmetadata();assert.equal(v.plays,0);v.readyState=1;playPreview(v);assert.equal(v.plays,1);});

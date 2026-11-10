// Run: node --experimental-vm-modules --test tests/snap/test_increment_seed.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
test('increment mode advances only after queueing, wraps at bounds, and fixed stays fixed',async()=>{
 const listeners=new Map(),seed={name:'noise_seed',value:41,options:{min:0,max:43}},node={widgets:[seed]};
 const app={graph:{extra:{snap:{bricks:[{key:'render',nodes:{render:1}}]}},getNodeById:()=>node},canvas:{emitBeforeChange(){},emitAfterChange(){},setDirty(){}}};
 const api={addEventListener:(name,fn)=>listeners.set(name,fn)};
 const bricks={BRICKS:{render:{face:[['render','noise_seed','seed']]}},RENDER_BLUEPRINT:'test',SIMPLE_RECIPE:[]};
 const context=vm.createContext({console});
 const engine=new vm.SourceTextModule(await readFile(new URL('../../web/snap/engine.js',import.meta.url),'utf8'),{context});
 await engine.link(async path=>{const values=path.endsWith('/app.js')?{app}:path.endsWith('/api.js')?{api}:bricks;return new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{context});});await engine.evaluate();
 const E=engine.namespace,queued=listeners.get('promptQueued');
 queued();assert.equal(seed.value,41);
 E.setSeedMode('render','increment');assert.equal(seed.value,41);assert.equal(E.seedMode('render'),'increment');
 queued();assert.equal(seed.value,42);queued();assert.equal(seed.value,43);queued();assert.equal(seed.value,0);
 assert.equal(app.graph.extra.snap.bricks[0].seed,'increment');
 E.setSeedMode('render','fixed');queued();assert.equal(seed.value,0);assert.equal(E.seedMode('render'),'fixed');
 E.setSeedMode('render','random');assert.equal(E.seedMode('render'),'random');queued();assert.ok(seed.value>=0&&seed.value<=43);
});

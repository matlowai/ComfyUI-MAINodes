import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const excerpt=JSON.parse(fs.readFileSync(new URL('./instruction_matcher.fixture.json',import.meta.url)));
const context={tool:null,bricks:[],methods:[],pins:[],scene:null,shot:null,take:null};
const evaluate=(text)=>vm.runInNewContext(`${text}; matches`,{W:{get:r=>r==='book:film'?{version:{body:{scenes:['s1']}}}:null}});
test('captured original matcher reproduces the Book-scope gap; patch fixes explicit scope',()=>{
 assert.equal(evaluate(excerpt.original)('book:film',{...context,pins:['book:film']}),false);
 assert.equal(evaluate(excerpt.patched)('book:film',{...context,pins:['book:film']}),true);
});
test('Book scope follows native scene ownership and never matches another Book',()=>{
 const m=evaluate(excerpt.patched);assert.equal(m('book:film',{...context,scene:'s1',shot:'sh1'}),true);
 assert.equal(m('book:other',{...context,scene:'s1'}),false);assert.equal(m('book:film',{...context,scene:'s2'}),false);
 assert.equal(m('book:film',{...context,book:'other',scene:'s1'}),false);
});
test('non-Book scope behavior is unchanged across representative native contexts',()=>{
 const old=evaluate(excerpt.original),patched=evaluate(excerpt.patched);
 for(const scope of ['global','tool:run','brick:render','method:ph3_view','cast:a','location:room','scene:s1','shot:s1/sh1','take:t1','unknown:x'])for(const c of [context,{...context,tool:'run',scene:'s1',shot:'sh1',take:'t1',pins:['cast:a'],bricks:['render'],methods:['ph3_view']}])assert.equal(patched(scope,c),old(scope,c));
});

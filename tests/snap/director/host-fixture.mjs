// In-memory native dependencies. Calls enter the production host/service code, not a reimplementation.
import { createNativeHost } from '../../../web/snap/director/host.mjs';
import { createDirectorService } from '../../../web/snap/director/service.mjs';
import { catalogue, tools, methods, instructionStack, parameterNote } from './fixtures.mjs';
export function harness() {
 const events=[],records=new Map(),scenes=new Map(),takes=new Map();let catalogueResponse=null,methodProblem=null,scopeRows=[],above=false,locked=false;
 const parse=(ref)=>{const m=/^([a-z_]+):([^@]+)(?:@(\d+))?$/.exec(ref);if(!m)throw new Error('bad native ref');return {kind:m[1],id:m[2],n:m[3]?Number(m[3]):null};};
 const put=(kind,id,body,n=1)=>{const record={kind,id,head:n,archived:null,versions:[{n,hash:`hash-${id}-${n}`,body:structuredClone(body)}]};records.set(`${kind}:${id}`,record);return record;};
 put('book','film',{name:'Fixture',story:'story:film',style:'look:film',cast:['cast:a'],locations:['location:room'],scenes:['s1']});
 put('story','film',{beats:[{id:'b1',order:1,told:1,text:'Hello.',lines:[{who:'cast:a',text:'Hello.'}],changes:[]}],groups:[]});
 put('look','film',{name:'Look',paragraph:'Natural lighting.'});put('cast','a',{name:'A',refs:[{file:'a.png'}],voice:{file:'a.wav'}});put('location','room',{name:'Room'});
 scenes.set('s1',{id:'s1',name:'One',book:'book:film',head:1,shots:[{id:'sh1',active:null,unit:{cut:'C1',beats:['b1'],cast:['cast:a'],location:'location:room',plate:'east',timing:{seconds:5}}}]});
 takes.set('take-original',{id:'take-original',status:'success',media:[{kind:'video',filename:'synthetic.mp4',type:'output'}],world:{'cast:a':{n:1}},story:{book:'book:film',unit:{scene:'s1',shot:'sh1'}}});
 const W={parse,get:ref=>{const p=parse(ref),record=records.get(`${p.kind}:${p.id}`);if(!record)return null;const version=record.versions.find(v=>v.n===(p.n??record.head));return version?{record,version}:null;},all:kind=>[...records.values()].filter(r=>r.kind===kind&&!r.archived),record:(kind,id)=>records.get(`${kind}:${id}`),save:async(kind,id,body,options)=>{events.push(['save',kind,id,structuredClone(body),options]);const old=records.get(`${kind}:${id}`);if(!old)put(kind,id,body);return {ref:`${kind}:${id}@1`,n:1,made:!old};}};
 const I={ready:async()=>{events.push(['ready']);},by:()=> 'agent:test',answer:async(context)=>{events.push(['instructions',structuredClone(context)]);const rows=scopeRows.filter(r=>r.scope==='global'||r.scope===`book:${context.book}`||r.scope===`scene:${context.scene}`||r.scope===`shot:${context.scene}/${context.shot}`||r.scope===`tool:${context.tool}`||(r.scope.startsWith('method:')&&context.methods.includes(r.scope.slice(7))));return {...instructionStack(...rows),context};}};
 const api={getUserData:async path=>{events.push(['read',path]);const id=/^snap\/scenes\/(.*)\.json$/.exec(path)?.[1],body=scenes.get(id);return {status:body?200:404,ok:!!body,json:async()=>structuredClone(body)};}};
 const T={reload:async()=>events.push(['take-reload']),privacyOn:async()=>true,find:ref=>takes.get(ref),reopen:async()=>events.push(['reopen']),aboveCap:()=>above,locked:()=>locked};
 const S={load:async()=>{},registryProblem:()=>methodProblem,slots:()=>['edit','view','upscale','recast'],slot:()=>({purposes:{character:{method:'ph3_view'},set:{method:'ph3_view'}}}),list:slot=>methods.filter(m=>m.slot===slot)};
 const P={load:async()=>{},all:()=>[],add:async(...args)=>{events.push(['propose',...args]);return {id:'p1'};},pressedBy:()=>({by:'person'})};
 const dependencies={api,W,I,S,P,T,ACC:{load:async()=>events.push(['account'])},origin:'http://fixture.local',catalogueURL:'http://fixture.local/extensions/MAINodes/director/strategies.json',getTools:()=>[...tools,...service],fetch:async(url)=>{events.push(['fetch',String(url)]);return catalogueResponse??{ok:true,status:200,json:async()=>structuredClone(catalogue)};}};
 const host=createNativeHost(dependencies);const service=createDirectorService(host);
 const call=(name,args={},ctx={})=>service.find(t=>t.name===name).run(args,ctx);
 return {host,service,call,events,records,scenes,takes,W,dependencies,put,parse,
  preferences:rows=>scopeRows=rows,catalogueResponse:r=>catalogueResponse=r,methodProblem:s=>methodProblem=s,above:v=>above=v,private:v=>locked=v,
  note:parameterNote};
}

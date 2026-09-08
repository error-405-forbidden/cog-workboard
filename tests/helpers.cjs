const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
function timers(){let id=0;const jobs=new Map();return {jobs,setTimeout(fn){jobs.set(++id,fn);return id;},clearTimeout(id){jobs.delete(id);},setInterval(fn){jobs.set(++id,fn);return id;},clearInterval(id){jobs.delete(id);},runAll(){const list=[...jobs.values()];jobs.clear();list.forEach(fn=>fn());}};}
function load(extra={}){const clock=timers();const sandbox={console,Date,Intl,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,setInterval:clock.setInterval,clearInterval:clock.clearInterval,...extra};sandbox.window=sandbox;const context=vm.createContext(sandbox);for(const name of ['workboard-core','records-ui'])vm.runInContext(fs.readFileSync(path.join(root,'assets',name+'.js'),'utf8'),context,{filename:name});return {W:context.Workboard,context,clock};}
function fakeRTDB(initial={}){
 let data=structuredClone(initial),seq=0,queue=Promise.resolve();const listeners=new Map(),writes=[];let fail=false;
 const parts=p=>p.split('/').filter(Boolean);
 function read(p){return parts(p).reduce((v,k)=>v&&v[k],data)??null;}
 function put(p,v){const keys=parts(p);if(!keys.length){data=v;return;}let cursor=data;for(const k of keys.slice(0,-1)){if(!cursor[k])cursor[k]={};cursor=cursor[k];}if(v===null)delete cursor[keys.at(-1)];else cursor[keys.at(-1)]=structuredClone(v);}
 const snap=p=>({val:()=>structuredClone(read(p))});
 function emit(){for(const [p,set]of listeners)for(const fn of set)fn(snap(p));}
 function ref(p=''){return {key:parts(p).at(-1),once:async()=>snap(p),push:()=>ref(p+'/new'+(++seq)),set:async v=>{if(fail)throw Error('offline');put(p,v);writes.push({p,type:'set',v});emit();},update:async v=>{if(fail)throw Error('offline');put(p,{...read(p),...v});writes.push({p,type:'update',v});emit();},remove:async()=>{if(fail)throw Error('offline');put(p,null);writes.push({p,type:'remove'});emit();},
 on:(event,fn)=>{if(!listeners.has(p))listeners.set(p,new Set());listeners.get(p).add(fn);queueMicrotask(()=>{if(listeners.get(p)?.has(fn))fn(snap(p));});return fn;},off:(event,fn)=>listeners.get(p)?.delete(fn),
 transaction:(fn,completion,local)=>{const operation=queue.then(()=>{if(fail)throw Error('offline');const next=fn(structuredClone(read(p)));if(next===undefined)return {committed:false,snapshot:snap(p)};put(p,next);writes.push({p,type:'transaction',v:next,local});emit();return {committed:true,snapshot:snap(p)};});queue=operation.catch(()=>{});return operation;}};}
 return {ref,writes,listeners,read:p=>structuredClone(read(p)),external:(p,v)=>{put(p,v);emit();},fail:value=>{fail=value;}};
}
// Small DOM doubles for startup/event tests, not a browser or layout emulator.
function fakeDocument(html=''){
 const ids=new Map();let doc;
 function element(tag='div',id=''){
  const handlers=new Map(),attributes=new Map(),children=[];
  const el={tagName:tag.toUpperCase(),id,value:'',textContent:'',innerHTML:'',dataset:{},hidden:false,disabled:false,style:{setProperty(){}},children,parentNode:null,isConnected:true,
   classList:{add(){},remove(){},toggle(){}},setAttribute(k,v){attributes.set(k,String(v));},getAttribute:k=>attributes.get(k)||null,
   addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);},removeEventListener(type,fn){handlers.set(type,(handlers.get(type)||[]).filter(x=>x!==fn));},dispatch:async(type,event)=>{for(const fn of handlers.get(type)||[])await fn(event);},
   append(...nodes){for(const n of nodes){if(n)n.parentNode=el;children.push(n);}},appendChild(n){el.append(n);},replaceChildren(...nodes){children.splice(0);el.append(...nodes);},replaceWith(){},
   querySelectorAll(selector){if(selector==='[data-field]')return [...ids.values()].filter(n=>n.dataset.field);if(selector==='input,textarea,select,button')return [...ids.values()].filter(n=>['INPUT','TEXTAREA','SELECT','BUTTON'].includes(n.tagName));return [];},
   querySelector(){return element('span');},contains(n){return n===el||children.includes(n);},focus(){doc.activeElement=el;},select(){},setSelectionRange(){},showModal(){el.open=true;},close(){el.open=false;},reset(){},closest(){return el;}};
  if(tag==='template')el.content=element('fragment');return el;
 }
 const tags=[...html.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)];
 tags.forEach(m=>{const el=element(m[1],m[3]);const field=m[2].match(/data-field="([^"]+)"/);if(field)el.dataset.field=field[1];ids.set(m[3],el);});
 doc={ids,activeElement:null,body:element('body'),getElementById:id=>{if(!ids.has(id))throw Error('Missing DOM id: '+id);return ids.get(id);},createElement:tag=>element(tag),querySelector:()=>null,querySelectorAll:selector=>selector==='dialog[open]'?[...ids.values()].filter(n=>n.open):[]};return doc;
}
module.exports={load,fakeRTDB,fakeDocument,root};

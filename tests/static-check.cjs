const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
for(const page of ['index','notes']){
 const source=fs.readFileSync(path.join(root,page+'.html'),'utf8');
 const ids=[...source.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,page+' duplicate id');
 // A cache-busting "?v=..." query string is expected on our own local assets; strip it before checking the file exists.
 for(const m of source.matchAll(/(?:src|href)="([^"#]+)"/g)){if(/^(?:https?:|data:)/.test(m[1]))continue;const file=m[1].split('?')[0];assert(fs.existsSync(path.resolve(root,file)),page+' missing asset '+m[1]);}
 const app=fs.readFileSync(path.join(root,'assets',page+'-app.js'),'utf8');
 const refs=[...app.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
 const dynamic=new Set(['staffNextDate']);
 for(const id of refs)assert(ids.includes(id)||dynamic.has(id),page+' missing id '+id);
 assert(!/rtdb\.ref\(/.test(app),page+' bypasses shared adapter');
 assert(!/<style>|<script>/.test(source),page+' still contains embedded implementation');
}
for(const name of fs.readdirSync(path.join(root,'assets')).filter(n=>n.endsWith('.js')))new vm.Script(fs.readFileSync(path.join(root,'assets',name),'utf8'),{filename:name});
assert.match(fs.readFileSync(path.join(root,'robots.txt'),'utf8'),/Disallow:\s*\//);
console.log('PASS: static asset references, DOM ids, JavaScript syntax, shared DB adapter usage, robots.txt.');

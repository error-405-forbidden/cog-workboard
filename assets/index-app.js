(function(){
'use strict';

// ===== Firebase設定・ログイン =====
const W=Workboard;
var ALLOWED_EMAILS=["cogweb39@gmail.com","k.w.t.f.05@gmail.com","cog.media01@gmail.com","takegawa0526@gmail.com"];
firebase.initializeApp(WorkboardFirebase);
var auth=firebase.auth();
var rtdb=firebase.database();

const fsdb=W.createDb(rtdb);

const COLUMNS=[{key:'todo',label:'未着手',short:'未着手',color:'var(--blue)'},{key:'doing',label:'進行中',short:'進行中',color:'var(--accent)'},{key:'waiting',label:'保留（待ち）',short:'保留',color:'var(--amber)'},{key:'done',label:'完了',short:'完了',color:'var(--green)'},{key:'cancelled',label:'中止',short:'中止',color:'var(--muted)'}];
const QUICK_STATUS=[{key:'doing',label:'進行中'},{key:'done',label:'完了'},{key:'waiting',label:'保留'},{key:'cancelled',label:'中止'}];
const TAGS=W.TAGS;
const $=id=>document.getElementById(id);
const esc=W.esc;
const pad=n=>String(n).padStart(2,'0');
// Preserve the original local-calendar date convention used by the shared data.
const dateStr=W.dateStr;
const isoDay=W.isoDay;
const toMD=v=>{const s=isoDay(v);return s?Number(s.slice(5,7))+'/'+Number(s.slice(8,10)):'';};
const dayDiff=(a,b)=>{a=isoDay(a);b=isoDay(b);return a&&b?Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000):0;};
const unfinished=t=>t.status!=='done'&&t.status!=='cancelled';
const age=t=>t.createdAt?Math.max(1,dayDiff(t.createdAt,dateStr())+1):1;
const oneLine=s=>String(s||'').replace(/[\r\n\u2028\u2029]+/g,' ').trim();
let db=null,tasks=[],ready=false,hasData=false,scope='mine',mobileStatus='todo',me='',qaTags=[],qaType='single',boardDate=dateStr();
let editBase=null,editId=null,editInitial=null,editTags=[],editBusy=false,qaBusy=false,connectGeneration=0,unsubscribe=null,taskTimer=null,toastTimer,returnFocus;
let siteNotes=[],notesReady=false,notesHasData=false,noteBusy=false,noteProject=TAGS[0],notesUnsubscribe=null,notesGeneration=0,notesTimer=null;
const noteDrafts=new Map();
try{me=(localStorage.getItem('wb_me')||'').trim();}catch(e){}
function toast(message){(document.querySelector('dialog[open]')||document.body).append($('toast'));clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.add('show');toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500);}
function errorAt(id,message){$(id).textContent=message||'';$(id).hidden=!message;}
const labelTag=W.labelTag;
function renderTags(id,selected,onChange){$(id).replaceChildren();[...new Set(TAGS.concat(selected))].forEach(tag=>{const b=document.createElement('button');b.type='button';b.className='chip';b.textContent=labelTag(tag);b.setAttribute('aria-pressed',String(selected.includes(tag)));b.addEventListener('click',()=>{const n=selected.indexOf(tag);if(n<0)selected.push(tag);else selected.splice(n,1);b.setAttribute('aria-pressed',String(selected.includes(tag)));if(onChange)onChange();});$(id).append(b);});}
function renderDate(){$('todayLabel').textContent=new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date());$('todayLabel').dateTime=dateStr();const hour=new Date().getHours();$('cycleLabel').textContent=hour<12?'朝礼前後':hour<17?'日中':'終礼前後';}
function syncControls(){$('qaSubmit').disabled=!ready||qaBusy||!me;$('openSummary').disabled=!ready||!me;const missing=editId&&!tasks.some(t=>t.id===editId);$('editSave').disabled=!ready||editBusy||missing;$('addLog').disabled=!ready||editBusy||missing;$('deleteTask').disabled=!ready||editBusy||missing;$('clearSamples').disabled=!ready||samplesBusy;$('refreshSummary').disabled=!ready;$('copySummary').disabled=!ready;syncNoteControls();if(typeof staffStatus==='function')staffStatus();}
function renderIdentity(){$('nameNotice').hidden=!!me;$('qaOwner').textContent=me?'担当：'+me+'（変更は詳細から）':'名前を設定すると登録できます';$('qaAssignee').placeholder=me?'空欄なら '+me:'空欄ならあなた';$('noteAuthor').textContent=me?'記入者：'+me:'画面上部で名前を設定してください';syncControls();}
$('meInput').value=me;
function saveName(){const value=$('meInput').value.trim();if(!value){toast('名前を入力してください');$('meInput').focus();return;}me=value;try{localStorage.setItem('wb_me',me);toast('「'+me+'」として保存しました');}catch(e){toast('名前を設定しました。この環境では次回の再入力が必要です');}renderIdentity();renderBoard();}
$('meSave').addEventListener('click',saveName);$('meInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();saveName();}});$('focusName').addEventListener('click',()=>$('meInput').focus());
['mine','all'].forEach(s=>$(s==='mine'?'scopeMine':'scopeAll').addEventListener('click',()=>{scope=s;$('scopeMine').setAttribute('aria-pressed',String(s==='mine'));$('scopeAll').setAttribute('aria-pressed',String(s==='all'));renderBoard();}));
function setBoardDate(d){boardDate=d||dateStr();$('boardDate').value=boardDate;const onToday=boardDate===dateStr();$('qaDateHint').hidden=onToday;if(!onToday)$('qaDateHint').textContent=toMD(boardDate)+'の欄に追加されます';renderBoard();}
function shiftBoardDate(delta){const d=new Date(boardDate+'T00:00:00');d.setDate(d.getDate()+delta);setBoardDate(dateStr(d));}
$('boardDate').value=boardDate;
$('boardDate').addEventListener('change',()=>setBoardDate($('boardDate').value));
$('boardDatePrev').addEventListener('click',()=>shiftBoardDate(-1));
$('boardDateNext').addEventListener('click',()=>shiftBoardDate(1));
$('boardDateToday').addEventListener('click',()=>setBoardDate(dateStr()));
$('qaMoreToggle').addEventListener('click',()=>{const open=$('qaDetail').hidden;$('qaDetail').hidden=!open;$('qaMoreToggle').setAttribute('aria-expanded',String(open));$('qaMoreToggle').textContent=open?'− 詳細を閉じる':'＋ 期限・案件・担当者などを指定';});
document.querySelectorAll('[data-due]').forEach(b=>b.addEventListener('click',()=>{const n=b.dataset.due;if(n==='')$('qaDue').value='';else{const d=new Date();d.setDate(d.getDate()+Number(n));$('qaDue').value=dateStr(d);}}));
$('qaTypeRow').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{qaType=b.dataset.type;$('qaTypeRow').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));}));
function setFormDisabled(form,disabled){form.querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=disabled);}
$('qaTitle').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.isComposing)e.preventDefault();});
$('qaForm').addEventListener('submit',async e=>{e.preventDefault();if(!ready||qaBusy)return;if(!me){$('meInput').focus();return;}const title=$('qaTitle').value.trim();if(!title)return;const assignee=$('qaAssignee').value.trim()||me;const data={title,content:$('qaContent').value.trim()||title,status:'todo',waitingFor:'',cancelReason:'',assignee,projectTags:qaTags.slice(),taskType:qaType,dueDate:$('qaDue').value||null,createdAt:boardDate,updatedAt:boardDate,doneAt:null,logs:[],isSample:false};qaBusy=true;setFormDisabled($('qaForm'),true);$('qaSubmit').querySelector('span').textContent='保存中';errorAt('qaError','');try{await db.collection('tasks').add(data);$('qaForm').reset();qaTags=[];qaType='single';renderTags('qaTagRow',qaTags);$('qaTypeRow').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.type==='single')));$('qaDetail').hidden=true;$('qaMoreToggle').setAttribute('aria-expanded','false');$('qaMoreToggle').textContent='＋ 期限・案件・担当者などを指定';mobileStatus='todo';renderBoard();const dateNote=boardDate!==dateStr()?'（'+toMD(boardDate)+'）':'';toast((assignee===me?'タスクを追加しました':assignee+'さんのタスクとして追加しました（全員表示で確認）')+dateNote);}catch(err){errorAt('qaError','登録できませんでした。入力内容は残っています。接続を確認して、もう一度追加してください。');}finally{qaBusy=false;setFormDisabled($('qaForm'),false);$('qaSubmit').querySelector('span').textContent='追加';syncControls();$('qaTitle').focus();}});
function sortTasks(a,b){const terminal=!unfinished(a)&&!unfinished(b);if(terminal)return String(b.doneAt||b.updatedAt||'').localeCompare(String(a.doneAt||a.updatedAt||''));return String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999'))||String(a.createdAt||'').localeCompare(String(b.createdAt||''));}
// Day view: an unfinished task with a due date stays off the board until that day
// arrives (many tasks are only actionable on a specific date), then carries forward
// every day after — including once overdue, so it never silently disappears. A task
// with no due date carries forward every day from its creation date instead. A
// done/cancelled task belongs to the single day it was finished, like a daily log entry.
function inDateView(t,d){
 if(unfinished(t))return t.dueDate?d>=t.dueDate:(!t.createdAt||t.createdAt<=d);
 const finishedDay=t.status==='done'?isoDay(t.doneAt):isoDay(t.updatedAt);
 return !!finishedDay&&finishedDay===d;
}
function renderBoard(){
 const dateLabel=boardDate===dateStr()?'今日':toMD(boardDate)+(boardDate<dateStr()?'（過去）':boardDate>dateStr()?'（今後）':'');
 $('boardTitle').textContent=((scope==='mine'&&me)?'自分のタスク':'全員のタスク')+'・'+dateLabel;
 if(!hasData)return;
 // Name not set yet: fall back to showing everyone's tasks instead of hiding the board.
 const scoped=(scope==='mine'&&me)?tasks.filter(t=>t.assignee===me):tasks;
 const visible=scoped.filter(t=>inDateView(t,boardDate));
 $('counts').innerHTML='<span>未完了 <strong>'+visible.filter(unfinished).length+'</strong></span><span>'+dateLabel+'完了 <strong>'+visible.filter(t=>t.status==='done'&&isoDay(t.doneAt)===boardDate).length+'</strong></span>';
 $('sampleNote').hidden=!tasks.some(t=>t.isSample);
 $('mobileTabs').replaceChildren();$('board').replaceChildren();$('board').setAttribute('aria-busy','false');
 COLUMNS.forEach(col=>{
  const list=visible.filter(t=>t.status===col.key).sort(sortTasks);
  const tab=document.createElement('button');tab.type='button';tab.setAttribute('aria-pressed',String(mobileStatus===col.key));tab.setAttribute('aria-controls','column-'+col.key);tab.innerHTML=esc(col.short)+'<span>'+list.length+'</span>';tab.addEventListener('click',()=>{mobileStatus=col.key;renderBoard();});$('mobileTabs').append(tab);
  const el=document.createElement('section');el.id='column-'+col.key;el.className='column'+(mobileStatus===col.key?' mobile-active':'');el.style.setProperty('--col-color',col.color);el.setAttribute('aria-labelledby','heading-'+col.key);el.innerHTML='<div class="col-head"><h3 id="heading-'+col.key+'">'+col.label+'</h3><span class="col-count">'+list.length+'</span></div><div class="col-body"></div>';const body=el.querySelector('.col-body');
  if(!list.length){const empty=document.createElement('div');empty.className='empty';empty.innerHTML='<span class="empty-mark" aria-hidden="true">—</span>'+(col.key==='todo'?'追加したタスクが並びます':col.key==='done'?'完了したタスクが並びます':'タスクはありません');body.append(empty);}else list.forEach(t=>body.append(renderCard(t)));
  $('board').append(el);
 });
 const names=[...new Set(tasks.map(t=>t.assignee).filter(Boolean).concat(me?[me]:[]))];$('assignees').innerHTML=names.map(n=>'<option value="'+esc(n)+'"></option>').join('');
}
function renderCard(t){
 const active=unfinished(t),carry=active?age(t):0,overdue=active&&t.dueDate&&t.dueDate<dateStr(),dueToday=active&&t.dueDate===dateStr();
 const card=document.createElement('article');card.className='card'+(carry>=3?' stale':'')+(editId===t.id?' opened':'');
 const main=document.createElement('button');main.type='button';main.className='card-main';main.setAttribute('aria-label',t.title+' の詳細を開く');
 let html='';const tags=(t.projectTags||[]).map(tag=>'<span class="tag">'+esc(labelTag(tag))+'</span>').join('');if(t.isSample||t.taskType==='routine'||tags)html+='<span class="card-tags">'+(t.isSample?'<span class="tag">サンプル</span>':'')+(t.taskType==='routine'?'<span class="tag routine">ルーティン</span>':'')+tags+'</span>';
 html+='<span class="card-title">'+esc(t.title)+'</span>';
 if(t.content&&t.content!==t.title)html+='<span class="card-content">'+esc(t.content)+'</span>';
 html+='<span class="card-dates">'+(t.dueDate?'<span class="due'+(overdue?' overdue':dueToday?' today':'')+'">'+(overdue?'期限超過 ':dueToday?'今日まで ':'期限 ')+esc(toMD(t.dueDate))+'</span>':'<span class="due nodate">無期限</span>')+(carry>=2?'<span class="age">'+carry+'日目</span>':'')+'</span>';
 if(t.status==='waiting')html+='<span class="waiting-for">待ち先：'+esc(t.waitingFor||'未入力')+'</span>';
 if(t.status==='cancelled'&&t.cancelReason)html+='<span class="waiting-for cancel-note">中止理由：'+esc(t.cancelReason)+'</span>';
 main.innerHTML=html;main.addEventListener('click',()=>openEditor(t.id));card.append(main);
 const foot=document.createElement('div');foot.className='card-footer';foot.innerHTML='<span class="assignee">'+esc(t.assignee||'未設定')+(t.logs.length?'<span class="log-count">ログ '+t.logs.length+'</span>':'')+'</span>';
 if(unfinished(t)){
  const actions=document.createElement('div');actions.className='card-quick-actions';
  QUICK_STATUS.filter(q=>q.key!==t.status).forEach(q=>{
   const b=document.createElement('button');b.type='button';b.className='card-action';b.textContent=q.label;b.disabled=!ready;b.setAttribute('aria-label',t.title+' を'+q.label+'にする');
   b.addEventListener('click',async()=>{b.disabled=true;try{await updateStatus(t.id,q.key);toast(q.label+'にしました'+((q.key==='waiting'||q.key==='cancelled')?'（詳細はカードを開いて追記できます）':''));}catch(e){toast(W.message(e));}finally{b.disabled=!ready;}});
   actions.append(b);
  });
  foot.append(actions);
 }else{const b=document.createElement('button');b.className='card-action';b.type='button';b.textContent='詳細・編集';b.addEventListener('click',()=>openEditor(t.id));foot.append(b);}card.append(foot);return card;
}
async function updateStatus(id,status){if(!ready)throw new Error('offline');const t=tasks.find(x=>x.id===id);if(!t)throw new Error('missing');
 // doneAt is filed under the day being viewed (boardDate), not the real wall-clock date,
 // so marking something done while browsing a past day records it on that day.
 const patch={status,updatedAt:dateStr(),doneAt:status==='done'?(t.status==='done'?t.doneAt:boardDate):null};await db.doc('tasks/'+id).updateChecked(patch,{status:t._raw.status});}
function openDialog(dialog){returnFocus=document.activeElement;dialog.showModal();document.body.style.overflow='hidden';}
function closeDialog(dialog){dialog.close();document.body.style.overflow='';if(returnFocus&&returnFocus.isConnected)returnFocus.focus();else $('qaTitle').focus();}
function editorValues(){const values={};$('editForm').querySelectorAll('[data-field]').forEach(f=>values[f.dataset.field]=f.value);values.projectTags=editTags.slice();return values;}
function isDirty(){return editInitial&&JSON.stringify(editorValues())!==JSON.stringify(editInitial);}
function conditionalFields(){$('waitingField').hidden=$('editStatus').value!=='waiting';$('cancelField').hidden=$('editStatus').value!=='cancelled';}
$('editStatus').innerHTML=COLUMNS.map(c=>'<option value="'+c.key+'">'+c.label+'</option>').join('');$('editStatus').addEventListener('change',conditionalFields);
function renderLogs(t){$('editLogs').innerHTML=t.logs.length?'<div class="logs">'+t.logs.map(l=>'<div><time class="log-date">'+esc(isoDay(l.date)||l.date||'')+'</time><p class="log-text">'+esc(l.text)+'</p></div>').join('')+'</div>':'<p class="log-empty">まだログはありません</p>';$('editMeta').textContent='登録：'+(isoDay(t.createdAt)||'不明')+'　更新：'+(isoDay(t.updatedAt)||'不明');}
function openEditor(id){const t=tasks.find(t=>t.id===id);if(!t)return;editId=id;editBase={...t._raw};$('editForm').querySelectorAll('[data-field]').forEach(f=>{const k=f.dataset.field;f.value=t[k]||'';});editTags=t.projectTags.slice();renderTags('editTagRow',editTags);editInitial=editorValues();$('editNewLog').value='';errorAt('editError','');$('editNotice').hidden=true;renderLogs(t);conditionalFields();resetDeleteArm();syncControls();renderBoard();openDialog($('editDialog'));$('editTitle').focus();}
// Keep the existing in-page interaction; destructive actions use a shared two-click confirmation.
function requestCloseEditor(){if(editBusy){toast('保存が終わるまでお待ちください');return;}const dirty=isDirty()||$('editNewLog').value.trim();resetDeleteArm();editId=null;editInitial=null;renderBoard();closeDialog($('editDialog'));if(dirty)toast('保存していない変更を破棄しました');}
$('editClose').addEventListener('click',requestCloseEditor);$('editCancelBtn').addEventListener('click',requestCloseEditor);$('editDialog').addEventListener('cancel',e=>{e.preventDefault();requestCloseEditor();});
function setEditBusy(busy){editBusy=busy;setFormDisabled($('editForm'),busy);$('editClose').disabled=busy;syncControls();}
$('editForm').addEventListener('submit',async e=>{e.preventDefault();if(!ready||editBusy)return;const t=tasks.find(x=>x.id===editId);if(!t){errorAt('editError','このタスクは削除されています。');return;}const values=editorValues(),patch={};if(!values.title.trim()){$('editTitle').focus();return;}
 // Send only edited fields so an unrelated live update is not overwritten.
 Object.keys(values).forEach(k=>{if(JSON.stringify(values[k])!==JSON.stringify(editInitial[k]))patch[k]=typeof values[k]==='string'?values[k].trim():values[k];});
 if('dueDate' in patch)patch.dueDate=patch.dueDate||null;
 if('assignee' in patch)patch.assignee=patch.assignee||me||'未設定';
 if('content' in patch)patch.content=patch.content||values.title.trim();
 if('title' in patch&&!('content' in patch)&&t.content===t.title)patch.content=patch.title;
 if('status' in patch)patch.doneAt=patch.status==='done'?(t.status==='done'?t.doneAt:boardDate):null;
 const log=$('editNewLog').value.trim();
 if(!Object.keys(patch).length&&!log){requestCloseEditor();return;}const guarded=Object.keys(patch).filter(k=>k!=='doneAt');patch.updatedAt=dateStr();const baseline={...editBase};const targetId=editId;setEditBusy(true);$('editSave').textContent='保存中';errorAt('editError','');try{await db.doc('tasks/'+targetId).mutate(current=>{if(!current)throw W.failure('missing','このタスクは削除されています。');for(const k of guarded){if(!W.equal(current[k],baseline[k]))throw W.failure('conflict','同じ項目が別の操作で更新されました。入力内容を控えてから開き直してください。');}const next={...current,...patch};if(log)next.logs=(Array.isArray(current.logs)?current.logs:[]).concat({date:dateStr(),text:log});return next;});editId=null;editInitial=null;renderBoard();closeDialog($('editDialog'));toast('変更を保存しました'+(log?'（ログも追記）':''));}catch(err){errorAt('editError',W.message(err));}finally{setEditBusy(false);$('editSave').textContent='保存する';}});
$('addLog').addEventListener('click',async()=>{
 const text=$('editNewLog').value.trim();if(!text||!ready||editBusy)return;const targetId=editId;if(!tasks.some(x=>x.id===targetId))return;
 setEditBusy(true);errorAt('editError','');
 try{const next=await db.doc('tasks/'+targetId).mutate(current=>{if(!current)throw W.failure('missing','このタスクは削除されています。');return {...current,logs:(Array.isArray(current.logs)?current.logs:[]).concat({date:dateStr(),text}),updatedAt:dateStr()};});$('editNewLog').value='';renderLogs(normalize({id:targetId,data:()=>next}));toast('ログを追記しました');}
 catch(err){errorAt('editError',W.message(err));}finally{setEditBusy(false);}
});

const deleteArm=W.createDeleteArm(()=>{const armed=deleteArm.isArmed(editId);$('deleteTask').textContent=armed?'本当に削除？もう一度クリック':'削除';$('deleteTask').classList.toggle('armed',armed);});
function resetDeleteArm(){deleteArm.reset();}
$('deleteTask').addEventListener('click',async()=>{
 if(!ready||editBusy)return;const t=tasks.find(x=>x.id===editId);if(!t)return;
 if(!deleteArm.press(editId))return;
 resetDeleteArm();setEditBusy(true);try{await db.doc('tasks/'+editId).delete();editId=null;editInitial=null;renderBoard();closeDialog($('editDialog'));toast('タスクを削除しました');}catch(err){errorAt('editError','削除できませんでした。もう一度お試しください。');}finally{setEditBusy(false);}
});
function buildSummary(){
 const mine=tasks.filter(t=>t.assignee===me),done=mine.filter(t=>t.status==='done'&&isoDay(t.doneAt)===dateStr()).sort(sortTasks),remaining=mine.filter(unfinished).sort(sortTasks);
 const lines=['【本日完了】（'+oneLine(me)+'）'];if(!done.length)lines.push('・（本日完了した項目なし）');done.forEach(t=>lines.push('・'+oneLine(t.title)));lines.push('','【残タスク】');if(!remaining.length)lines.push('・（残タスクなし）');
 remaining.forEach(t=>{const suffix=[];if(t.dueDate)suffix.push('期限'+toMD(t.dueDate)+(t.dueDate<dateStr()?'・期限超過':''));if(t.status==='waiting')suffix.push(t.waitingFor?'待ち先：'+oneLine(t.waitingFor):'保留（待ち先未入力）');if(age(t)>=2)suffix.push(age(t)+'日目');lines.push('・'+oneLine(t.title)+(suffix.length?'（'+suffix.join('／')+'）':''));});
 $('summaryText').value=lines.join('\n');$('summaryOwner').textContent=me+'さん / '+dateStr();$('summaryDone').textContent=done.length;$('summaryRemaining').textContent=remaining.length;$('copyHelp').hidden=true;
}
$('openSummary').addEventListener('click',()=>{if(!me||!ready)return;buildSummary();openDialog($('summaryDialog'));});$('closeSummary').addEventListener('click',()=>closeDialog($('summaryDialog')));$('summaryDialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog($('summaryDialog'));});$('refreshSummary').addEventListener('click',()=>{if(!ready)return;buildSummary();toast('最新の内容に更新しました');});
$('copySummary').addEventListener('click',async()=>{if(!ready)return;const ta=$('summaryText');try{if(!navigator.clipboard||!navigator.clipboard.writeText)throw new Error('unsupported');await navigator.clipboard.writeText(ta.value);toast('コピーしました。Chatworkに貼り付けられます');}catch(e){ta.focus();ta.select();ta.setSelectionRange(0,ta.value.length);let copied=false;try{copied=document.execCommand('copy');}catch(err){}if(copied)toast('コピーしました。Chatworkに貼り付けられます');else{$('copyHelp').hidden=false;$('copyHelp').textContent='自動コピーできませんでした。本文を選択した状態で、Ctrl+C／⌘C、または端末の「コピー」を使ってください。';}}});
let samplesBusy=false;
const samplesArm=W.createDeleteArm(()=>{$('clearSamples').textContent=samplesArm.isArmed('samples')?'本当に削除？もう一度クリック':'サンプルを削除';});
$('clearSamples').addEventListener('click',async()=>{
 if(!ready||samplesBusy)return;if(!samplesArm.press('samples'))return;samplesBusy=true;
 $('clearSamples').disabled=true;let failed=0;for(const t of tasks.filter(t=>t.isSample)){try{await db.doc('tasks/'+t.id).delete();}catch(e){failed++;}}toast(failed?'一部のサンプルを削除できませんでした。再度お試しください':'サンプルを削除しました');samplesBusy=false;syncControls();
});
function normalize(doc){const raw=doc.data()||{};return {...raw,_raw:raw,id:doc.id,title:String(raw.title||'（タイトルなし）'),content:String(raw.content||raw.title||''),status:COLUMNS.some(c=>c.key===raw.status)?raw.status:'todo',assignee:String(raw.assignee||'未設定'),projectTags:Array.isArray(raw.projectTags)?raw.projectTags.filter(x=>typeof x==='string'):[],taskType:raw.taskType==='routine'?'routine':'single',dueDate:isoDay(raw.dueDate)||null,logs:Array.isArray(raw.logs)?raw.logs.filter(l=>l&&typeof l.text==='string'):[],waitingFor:String(raw.waitingFor||''),cancelReason:String(raw.cancelReason||'')};}

// siteMemos collection: {projectTag, text, date: YYYY-MM-DD,
// author, createdAt: ISO timestamp}. No task id, status or task lifecycle coupling.
// Each site is presented as ONE timeline; entries are separate shared documents.
const canonicalProject=W.canonicalProject;
const noteCreatedDay=W.createdDay;
const normalizeNote=W.normalizeMemo;
let siteMemoComments=[],commentsReady=false,commentsFailed=false,commentsUnsubscribe=null,commentsTimer=null;
let notesUI=null,notesUnbind=null;
function resetNotesUI(){if(notesUnbind)notesUnbind();if(notesUI)notesUI.dispose();notesUI=W.createRecordsUI({db:()=>fsdb,records:key=>key==='siteMemos'?siteNotes:siteMemoComments,loaded:key=>key==='siteMemos'?notesHasData:commentsReady,error:key=>key==='siteMemoComments'&&commentsFailed,canWrite:key=>!!auth.currentUser&&!auth.currentUser.isAnonymous&&ALLOWED_EMAILS.includes(auth.currentUser.email)&&(key==='siteMemos'?notesReady:commentsReady),author:()=>me,render:force=>renderNoteHistory(force)});notesUnbind=notesUI.bind($('noteHistory'));}

function getNoteProjects(){return [...new Set(TAGS.concat(tasks.flatMap(t=>t.projectTags||[]),siteNotes.map(n=>n.projectTag),[noteProject]).map(canonicalProject))];}
function projectNotes(project,order){return W.sortMemos(siteNotes.filter(n=>n.projectTag===canonicalProject(project)),order);}
function syncNoteControls(){$('noteSubmit').disabled=!notesReady||noteBusy||!me;$('noteText').disabled=noteBusy;$('noteDate').disabled=noteBusy;$('notesProjectSelect').disabled=noteBusy;$('notesProjects').querySelectorAll('button').forEach(b=>b.disabled=noteBusy);$('noteSubmit').textContent=noteBusy?'保存中…':'この案件に追記';}
let currentView='tasks';
function showView(view){currentView=view;$('tasksView').hidden=view!=='tasks';$('notesView').hidden=view!=='notes';$('staffView').hidden=view!=='staff';$('showTasks').setAttribute('aria-pressed',String(view==='tasks'));$('showNotes').setAttribute('aria-pressed',String(view==='notes'));$('showStaff').setAttribute('aria-pressed',String(view==='staff'));if(view==='notes')renderNotes();else if(view==='staff')renderStaff();}
$('showTasks').addEventListener('click',()=>showView('tasks'));$('showNotes').addEventListener('click',()=>showView('notes'));$('showStaff').addEventListener('click',()=>showView('staff'));
function saveNoteDraft(){noteDrafts.set(noteProject,{text:$('noteText').value,date:$('noteDate').value});}
function chooseNoteProject(project){if(noteBusy)return;saveNoteDraft();noteProject=canonicalProject(project);const draft=noteDrafts.get(noteProject);$('noteText').value=draft?draft.text:'';$('noteDate').value=draft?draft.date:dateStr();errorAt('noteError','');renderNotes();}
$('notesProjectSelect').addEventListener('change',e=>chooseNoteProject(e.target.value));$('noteText').addEventListener('input',saveNoteDraft);$('noteDate').addEventListener('input',saveNoteDraft);$('noteSort').addEventListener('change',renderNoteHistory);
function renderNoteProjects(){const projects=getNoteProjects();$('notesProjects').replaceChildren();$('notesProjectSelect').replaceChildren();projects.forEach(tag=>{const entries=siteNotes.filter(n=>n.projectTag===tag);const count=entries.length;
 // Same pin as on the memo itself, so a fresh addition is visible from the project list without opening it.
 const freshest=entries.reduce((latest,n)=>!latest||n.createdAt>latest?n.createdAt:latest,'');const pin=W.pinBadge(freshest);
 const b=document.createElement('button');b.type='button';b.className='project-button';b.setAttribute('aria-pressed',String(tag===noteProject));b.innerHTML='<span class="project-name">'+esc(labelTag(tag))+(pin?' '+pin:'')+'</span><span class="project-count">'+(notesHasData?count+'件':'—')+'</span>';b.addEventListener('click',()=>chooseNoteProject(tag));$('notesProjects').append(b);const option=document.createElement('option');option.value=tag;option.textContent=labelTag(tag)+(notesHasData?'（'+count+'件）':'');$('notesProjectSelect').append(option);});$('notesProjectSelect').value=noteProject;syncNoteControls();}
function renderNoteHistory(force=false){
 const full=projectNotes(noteProject,$('noteSort').value);$('noteHistoryHeading').textContent='これまでの記録'+(notesHasData?'（'+full.length+'件）':'');
 if(!notesUI)return;
 const order=$('noteSort').value;
 const collapsed=full.length>10&&!notesUI.isThreadExpanded('memolist',noteProject),list=collapsed?full.slice(0,10):full;
 const content=(collapsed?notesUI.moreButton('memolist',noteProject,full.length-list.length):'')+list.map(n=>notesUI.memo(n,order)).join('')+notesUI.orphanMemos(noteProject);
 $('noteHistory').className=content?'note-history':'';
 W.replaceContent($('noteHistory'),content||'<div class="note-empty">'+(notesHasData?'<strong>まだ記録はありません</strong>最初の申し送りや、これまでの経緯を追記してください。':'接続後に、この案件の記録が表示されます。')+'</div>',!force);
}
function renderNotes(){$('notesProjectHeading').textContent=labelTag(noteProject);renderNoteProjects();renderNoteHistory();}
function notesState(state,message){notesReady=state==='ready';$('notesStatus').hidden=notesReady;$('notesStatus').className='notes-status'+(state==='error'?' error':'');$('notesStatusText').textContent=message||'サイトメモを読み込み中…';$('notesRetry').hidden=state!=='error';$('noteHistory').setAttribute('aria-busy',String(state==='loading'));syncNoteControls();}
function stopNotes(){clearTimeout(commentsTimer);if(commentsUnsubscribe)commentsUnsubscribe();commentsUnsubscribe=null;commentsReady=false;commentsFailed=false;++notesGeneration;clearTimeout(notesTimer);if(typeof notesUnsubscribe==='function'){try{notesUnsubscribe();}catch(e){}}notesUnsubscribe=null;notesState('loading');}
function connectNotes(connection){stopNotes();const generation=notesGeneration;let receivedLive=false;const onError=()=>{if(generation!==notesGeneration)return;receivedLive=true;clearTimeout(notesTimer);notesState('error','サイトメモを読み込めませんでした。表示中の記録が最新でない可能性があります。入力内容は残っています。');};
 notesTimer=setTimeout(()=>{if(generation===notesGeneration)notesState('error','サイトメモの接続に時間がかかっています。接続すると自動で表示します。');},12000);
 function onData(snap,live){if(generation!==notesGeneration||(!live&&receivedLive))return;if(live)receivedLive=true;clearTimeout(notesTimer);siteNotes=snap.docs.map(normalizeNote);notesHasData=true;notesState('ready');renderNotes();}
 try{commentsTimer=setTimeout(()=>{if(generation===notesGeneration){commentsReady=false;commentsFailed=true;renderNoteHistory();}},12000);commentsUnsubscribe=connection.collection('siteMemoComments').onSnapshot(snap=>{if(generation!==notesGeneration)return;clearTimeout(commentsTimer);siteMemoComments=snap.docs.map(d=>W.normalizeComment(d,'memoId'));commentsReady=true;commentsFailed=false;renderNoteHistory();},()=>{if(generation!==notesGeneration)return;clearTimeout(commentsTimer);commentsReady=false;commentsFailed=true;renderNoteHistory();});const collection=connection.collection('siteMemos');notesUnsubscribe=collection.onSnapshot(snap=>onData(snap,true),onError);collection.get().then(snap=>onData(snap,false)).catch(()=>{});}catch(e){onError();}
}
$('notesRetry').addEventListener('click',()=>{if(db)connectNotes(db);else boot();});
$('noteForm').addEventListener('submit',async e=>{
 e.preventDefault();if(noteBusy||!notesReady)return;if(!me){$('meInput').focus();return;}const text=$('noteText').value.trim(),date=$('noteDate').value;if(!text||!date){errorAt('noteError','メモと記録日を入力してください。');return;}
 const project=noteProject,data={projectTag:project,text,date,author:me,createdAt:new Date().toISOString()};noteBusy=true;saveNoteDraft();syncNoteControls();errorAt('noteError','');
 try{await db.collection('siteMemos').add(data);noteDrafts.delete(project);$('noteText').value='';$('noteDate').value=dateStr();toast(labelTag(project)+'にメモを追記しました');}
 catch(err){errorAt('noteError','追記できませんでした。入力内容は残っています。接続を確認してもう一度追記してください。');}
 finally{noteBusy=false;syncNoteControls();$('noteText').focus();}
});

// ---------- 外注さん（案件のサイトメモとは別枠。1人=1プロフィール＋ログ） ----------
const staffCollections=['staffProfiles','staffNotes'];
let staffRecords=Object.fromEntries(staffCollections.map(k=>[k,[]]));
let staffStates=Object.fromEntries(staffCollections.map(k=>[k,'loading']));
let staffDisposers=[],staffDateTimers=new Map(),staffDateState=new Map();
let currentStaffId=null,staffAdding=false,staffGeneration=0,staffLogOrder='newest';
let staffUI=null,staffUnbind=null,staffLogUnbind=null;
function canWriteStaff(){return !!auth.currentUser&&!auth.currentUser.isAnonymous&&ALLOWED_EMAILS.includes(auth.currentUser.email);}
function resetStaffUI(){if(staffUnbind)staffUnbind();if(staffLogUnbind)staffLogUnbind();if(staffUI)staffUI.dispose();staffUI=W.createRecordsUI({db:()=>fsdb,records:key=>staffRecords[key],loaded:key=>staffStates[key]==='ready',error:key=>staffStates[key]==='error',canWrite:key=>canWriteStaff()&&staffStates[key]==='ready',author:()=>me,render:force=>renderStaff(force)});staffUnbind=staffUI.bind($('staffDetail'));staffLogUnbind=staffUI.bind($('staffLogPane'));}
function staffStatus(){const error=staffCollections.some(k=>staffStates[k]==='error'),allReady=staffCollections.every(k=>staffStates[k]==='ready');$('staffStatus').hidden=allReady&&!error;$('staffStatus').className='notes-status'+(error?' error':'');$('staffStatusText').textContent=error?'読み込めませんでした。時間をおいて再度開いてください。':'読み込み中…';$('staffAdd').disabled=!allReady||staffAdding||!me;$('staffAddMobile').disabled=$('staffAdd').disabled;}
function chooseStaff(id){currentStaffId=id;staffUI.resetConfirmation();renderStaff(true);}
function renderStaffList(){const list=staffRecords.staffProfiles.slice().sort((a,b)=>a.name.localeCompare(b.name,'ja'));$('staffList').replaceChildren();$('staffSelect').replaceChildren();list.forEach(p=>{const b=document.createElement('button');b.type='button';b.className='project-button';b.setAttribute('aria-pressed',String(p.id===currentStaffId));b.innerHTML='<span class="project-name">'+esc(p.name||'（名前未設定）')+'</span>';b.addEventListener('click',()=>chooseStaff(p.id));$('staffList').append(b);const opt=document.createElement('option');opt.value=p.id;opt.textContent=p.name||'（名前未設定）';$('staffSelect').append(opt);});if(currentStaffId)$('staffSelect').value=currentStaffId;}
$('staffSelect').addEventListener('change',e=>chooseStaff(e.target.value));
$('staffLogSort').addEventListener('change',()=>{staffLogOrder=$('staffLogSort').value;renderStaff(true);});
async function addStaff(){
 if(staffAdding||staffStates.staffProfiles!=='ready'||!me){if(!me)$('meInput').focus();return;}
 const session=staffGeneration;staffAdding=true;staffStatus();
 try{const data={name:'新しい外注さん',profile:'',currentWork:'',updatedAt:new Date().toISOString()};const ref=await fsdb.collection('staffProfiles').add(data);if(session!==staffGeneration)return;currentStaffId=ref.id;if(!staffRecords.staffProfiles.some(p=>p.id===ref.id))staffRecords.staffProfiles.push(W.normalizeStaff({id:ref.id,data:()=>data}));staffUI.startEdit('staff',ref.id);renderStaff(true);}
 catch(err){if(session===staffGeneration)toast(W.message(err));}
 finally{if(session===staffGeneration){staffAdding=false;staffStatus();}}
}
$('staffAdd').addEventListener('click',addStaff);$('staffAddMobile').addEventListener('click',addStaff);
function renderStaff(force=false){
 let p=staffRecords.staffProfiles.find(p=>p.id===currentStaffId);
 if(!p&&currentStaffId)p=staffUI.editingRecord('staff',currentStaffId);
 if(!p){p=staffRecords.staffProfiles.slice().sort((a,b)=>a.name.localeCompare(b.name,'ja'))[0];currentStaffId=p?p.id:null;}
 renderStaffList();
 if(!p){W.replaceContent($('staffDetail'),'<div class="note-empty">'+(staffStates.staffProfiles==='ready'?'<strong>まだ外注さんが登録されていません</strong><p>「＋」から追加してください。</p>':'読み込み中です…')+'</div>',!force);W.replaceContent($('staffLog'),'',!force);W.replaceContent($('staffLogActions'),'',!force);return;}
 const present=staffRecords.staffProfiles.some(r=>r.id===p.id),next=staffDateState.get(p.id)||{},disabled=!canWriteStaff()||staffStates.staffProfiles!=='ready'||next.busy||!present;
 const nextRow='<div class="staff-next"><label for="staffNextDate">次回依頼日</label><input type="date" id="staffNextDate" value="'+esc(next.busy?next.value:p.nextRequestDate||'')+'" data-id="'+esc(p.id)+'"'+(disabled?' disabled':'')+'><button type="button" class="next-clear" data-next-clear="'+esc(p.id)+'"'+(disabled?' disabled':'')+'>クリア</button><span class="saved-flag"'+(next.saved?'':' hidden')+'>保存しました</span>'+(next.error?'<span class="form-msg" role="alert">'+esc(next.error)+'</span>':'')+'</div>';
 const updated=p.updatedAt?W.createdDay(p.updatedAt):'';
 // Edit/delete sit next to the name itself instead of a separate row far below the content.
 const headActions='<span class="row-actions"><button type="button" data-wb-action="edit" data-kind="staff" data-id="'+esc(p.id)+'"'+(!present||!canWriteStaff()?' disabled':'')+'>編集</button><button type="button" data-wb-action="delete" data-kind="staff" data-id="'+esc(p.id)+'"'+(!present||!canWriteStaff()||staffUI.isDeleting(p.id)?' disabled':'')+'>'+(staffUI.isArmed(p.id)?'本当に削除？もう一度クリック':'削除')+'</button></span>';
 const errorMsg=staffUI.errorFor(p.id)?'<div class="form-msg" role="alert">'+esc(staffUI.errorFor(p.id))+'</div>':'';
 const body=staffUI.hasEditor('staff',p.id)?'<div class="staff-profile">'+staffUI.form('staff',p.id)+'</div>':'<div class="staff-profile"><div class="staff-name-row"><div class="staff-name">'+esc(p.name||'（名前未設定）')+'</div>'+headActions+'</div>'+errorMsg+'<div class="staff-section"><div class="staff-section-label">プロフィール</div><p class="project-note-text">'+esc(p.profile||'（未入力）')+'</p></div><div class="staff-section"><div class="staff-section-label">依頼している内容</div><p class="project-note-text">'+esc(p.currentWork||'（未入力）')+'</p></div>'+(updated?'<p class="staff-updated">最終更新：'+esc(updated)+'</p>':'')+'</div>';
 W.replaceContent($('staffDetail'),nextRow+body,!force);
 W.replaceContent($('staffLogActions'),staffUI.composeTrigger('staffnote',p.id),!force);
 W.replaceContent($('staffLog'),staffUI.thread('staffnote',p.id,staffLogOrder),!force);
}
async function saveStaffNextDate(id,value){
 const p=staffRecords.staffProfiles.find(p=>p.id===id);if(!p||staffStates.staffProfiles!=='ready'||staffDateState.get(id)?.busy)return;
 const session=staffGeneration,item={busy:true,value,error:'',saved:false};staffDateState.set(id,item);clearTimeout(staffDateTimers.get(id));renderStaff(true);
 try{await fsdb.doc('staffProfiles/'+id).updateChecked({nextRequestDate:value||null},{nextRequestDate:p._raw.nextRequestDate});if(session!==staffGeneration)return;item.saved=true;staffDateTimers.set(id,setTimeout(()=>{item.saved=false;staffDateTimers.delete(id);if(currentStaffId===id)renderStaff();},2000));}
 catch(err){if(session===staffGeneration)item.error=W.message(err);}
 finally{if(session===staffGeneration){item.busy=false;renderStaff(true);}}
}
$('staffDetail').addEventListener('change',e=>{if(e.target.id==='staffNextDate')void saveStaffNextDate(e.target.dataset.id,e.target.value);});
$('staffDetail').addEventListener('click',e=>{const b=e.target.closest('[data-next-clear]');if(b&&!b.disabled)void saveStaffNextDate(b.dataset.nextClear,'');});
function stopStaffData(){staffGeneration++;staffDisposers.splice(0).forEach(stop=>stop());staffDateTimers.forEach(clearTimeout);staffDateTimers.clear();staffDateState.clear();staffAdding=false;}
function connectStaff(){
 stopStaffData();const session=staffGeneration;
 const normalizers={staffProfiles:W.normalizeStaff,staffNotes:doc=>W.normalizeComment(doc,'staffId')};
 staffCollections.forEach(key=>{
  staffStates[key]='loading';let timer=setTimeout(()=>{if(session===staffGeneration){staffStates[key]='error';staffStatus();}},12000);staffDisposers.push(()=>clearTimeout(timer));
  staffDisposers.push(fsdb.collection(key).onSnapshot(snap=>{if(session!==staffGeneration)return;clearTimeout(timer);staffRecords[key]=snap.docs.map(normalizers[key]);staffStates[key]='ready';staffStatus();if(currentView==='staff')renderStaff();},()=>{if(session!==staffGeneration)return;clearTimeout(timer);staffStates[key]='error';staffStatus();if(currentView==='staff')renderStaff();}));
 });staffStatus();
}
resetStaffUI();staffStatus();

function connectionState(state){ready=state==='ready';$('connection').className='connection '+state;$('connection').querySelector('span').textContent=ready?'接続済み':state==='error'?'接続エラー':'接続中';$('dbStatus').hidden=state!=='error';syncControls();}
function showDbError(message){connectionState('error');$('dbErrorDetail').textContent=message;$('board').setAttribute('aria-busy','false');if(!hasData)$('board').innerHTML='<div class="board-state"><strong>接続後にタスクが表示されます</strong><p>上の案内を確認して、再接続してください。</p></div>';else renderBoard();}
async function boot(){
 const generation=++connectGeneration;clearTimeout(taskTimer);stopNotes();if(typeof unsubscribe==='function'){try{unsubscribe();}catch(e){}}unsubscribe=null;connectionState('loading');if(!hasData){$('board').setAttribute('aria-busy','true');$('board').innerHTML='<div class="board-state"><span class="spinner" aria-hidden="true"></span><strong>タスクを読み込み中</strong></div>';}
 let gotSnapshot=false;
 const timer=taskTimer=setTimeout(()=>{if(generation===connectGeneration){showDbError('接続に時間がかかっています。接続が完了すると自動で表示します。改善しない場合は再接続してください。');if(!notesReady)notesState('error','接続に時間がかかっています。接続が完了するとサイトメモを表示します。');}},12000);
 try{
  db=fsdb;connectNotes(db);
  function onData(snap,live){if(generation!==connectGeneration||(!live&&gotSnapshot))return;if(live)gotSnapshot=true;clearTimeout(timer);const next=snap.docs.map(normalize);tasks=next;hasData=true;connectionState('ready');renderBoard();renderNoteProjects();
   // Live changes refresh the board and logs, never overwrite an open draft.
   if(editId){const current=tasks.find(t=>t.id===editId);if(!current){$('editNotice').hidden=false;$('editNotice').textContent='このタスクは別の操作で削除されました。入力内容を確認して閉じてください。';$('editSave').disabled=true;$('addLog').disabled=true;$('deleteTask').disabled=true;}else{renderLogs(current);if(!editBusy){const changed=Object.keys(editInitial||{}).some(k=>k!=='projectTags'?String(current[k]||'')!==String(editInitial[k]||''):JSON.stringify(current[k])!==JSON.stringify(editInitial[k]));if(changed){$('editNotice').hidden=false;$('editNotice').textContent='このタスクに更新がありました。入力中の内容は保持しています。最新の内容は一度閉じて開き直すと確認できます。';}}}}
  }
  function onError(){if(generation!==connectGeneration)return;clearTimeout(timer);gotSnapshot=true;showDbError('接続が切れました。表示中の内容が最新でない可能性があります。再接続してください。入力中の内容は残っています。');}
  const col=db.collection('tasks');unsubscribe=col.onSnapshot(snap=>onData(snap,true),onError);col.get().then(snap=>onData(snap,false)).catch(()=>{});
 }catch(err){clearTimeout(timer);if(generation!==connectGeneration)return;if(!notesReady)notesState('error','データベースに接続できません。再接続してください。');showDbError('接続できませんでした。再接続してください。');}
}
$('dbRetry').addEventListener('click',()=>{if(auth.currentUser&&ALLOWED_EMAILS.includes(auth.currentUser.email))boot();});
resetNotesUI();$('noteDate').value=dateStr();renderNotes();

// ---------- 一時ヘルパー：旧サイトメモ（siteNotes、サイト単位のネスト構造）を
// 新しいサイトメモ（siteMemos、1件=1ドキュメントのフラット時系列）へコピーする ----------
// ログイン後、開発者コンソール（F12）で migrateSiteNotes() を1回実行すると復元される。
// 変換先のIDは元の場所から決まる固定値なので、複数回実行しても重複しない。
window.migrateSiteNotes=async function(){
 if(!auth.currentUser||!ALLOWED_EMAILS.includes(auth.currentUser.email)){toast('ログインしてから実行してください');return;}
 try{const snap=await fsdb.collection('siteNotes').get();let count=0;
  for(const doc of snap.docs){const site=doc.data()||{};for(const [entryId,e] of Object.entries(site.entries||{})){const created=await fsdb.doc('siteMemos/'+doc.id+'-'+entryId).createIfAbsent({projectTag:site.name||'その他',text:e.text||'',date:e.date||'',author:e.author||'未設定',createdAt:e.date?e.date+'T00:00:00.000Z':new Date().toISOString()});if(created)count++;}}
  toast(count?'サイトメモ'+count+'件を復元しました':'新しく復元するメモはありません');
 }catch(err){toast('復元に失敗しました: '+err.message);}
};
renderTags('qaTagRow',qaTags);renderDate();renderIdentity();

// ---------- ログイン（Googleサインイン・許可メールアドレスのみ） ----------
$('googleLoginBtn').addEventListener('click',function(){
  var provider=new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(function(err){
    $('loginError').textContent='ログインに失敗しました: '+err.message;
    $('loginError').style.display='block';
  });
});
$('logoutBtn').addEventListener('click',function(){ auth.signOut(); });
const stopAuth=auth.onAuthStateChanged(function(user){
  if(user&&!user.isAnonymous){
    if(ALLOWED_EMAILS.indexOf(user.email)===-1){
      cleanupData();$('loginScreen').hidden=false;$('appRoot').hidden=true;
      $('loginError').textContent='このアカウント（'+user.email+'）はアクセス許可がありません。';
      $('loginError').style.display='block';
      auth.signOut();
      return;
    }
    if(!me){ me=(user.displayName||user.email||'').trim(); try{localStorage.setItem('wb_me',me);}catch(e){} }
    $('meInput').value=me;
    if(user.photoURL){ $('meAvatar').src=user.photoURL; $('meAvatar').hidden=false; } else { $('meAvatar').hidden=true; }
    $('loginScreen').hidden=true;
    $('appRoot').hidden=false;
    resetNotesUI();renderIdentity();
    boot();resetStaffUI();connectStaff();
  } else {
    cleanupData();$('loginScreen').hidden=false;
    $('appRoot').hidden=true;
  }
});
function cleanupData(){++connectGeneration;clearTimeout(taskTimer);if(unsubscribe)unsubscribe();unsubscribe=null;stopNotes();ready=false;hasData=false;notesReady=false;notesHasData=false;tasks=[];siteNotes=[];siteMemoComments=[];resetDeleteArm();samplesArm.reset();if(notesUI)notesUI.dispose();editId=null;editInitial=null;editBase=null;for(const d of document.querySelectorAll('dialog[open]'))d.close();document.body.style.overflow='';$('board').replaceChildren();$('noteHistory').replaceChildren();syncControls();
 stopStaffData();staffRecords={staffProfiles:[],staffNotes:[]};staffStates={staffProfiles:'loading',staffNotes:'loading'};currentStaffId=null;if(staffUI)staffUI.dispose();$('staffDetail').replaceChildren();$('staffLog').replaceChildren();$('staffLogActions').replaceChildren();$('staffList').replaceChildren();
}
window.addEventListener('pagehide',()=>{cleanupData();stopAuth();if(notesUnbind)notesUnbind();if(staffUnbind)staffUnbind();if(staffLogUnbind)staffLogUnbind();deleteArm.dispose();samplesArm.dispose();clearTimeout(toastTimer);clearInterval(dayTimer);});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
let lastDay=dateStr();const dayTimer=setInterval(()=>{renderDate();const today=dateStr();if(lastDay!==today){if(boardDate===lastDay){boardDate=today;$('boardDate').value=boardDate;}lastDay=today;renderBoard();}},60000);
})();

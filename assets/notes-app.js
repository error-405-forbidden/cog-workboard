(function () {
  'use strict';
  const W=Workboard, E=W.esc, $=id=>document.getElementById(id);
  firebase.initializeApp(WorkboardFirebase);
  const auth=firebase.auth(), db=W.createDb(firebase.database());
  const collections=['siteMemos','siteMemoComments','staffProfiles','staffNotes'];
  const records=Object.fromEntries(collections.map(key=>[key,[]]));
  const states=Object.fromEntries(collections.map(key=>[key,'loading']));
  const disposers=[], dateTimers=new Map(), dateState=new Map();
  let currentView='notes', currentProject='ジムセレ', currentStaffId=null, authReady=false, activeUid=null, generation=0, signingIn=false, adding=false, staffLogOrder='newest';
  let ui, unbindHistory, unbindStaff, unbindStaffLog;
  function createUI(){
    if(unbindHistory)unbindHistory();if(unbindStaff)unbindStaff();if(unbindStaffLog)unbindStaffLog();if(ui)ui.dispose();
    ui=W.createRecordsUI({db:()=>db,records:key=>records[key],loaded:key=>states[key]==='ready',error:key=>states[key]==='error',canWrite:key=>authReady&&states[key]==='ready',render:force=>{if(currentView==='notes')renderHistory(force);else renderStaff(force);}});
    unbindHistory=ui.bind($('history'));unbindStaff=ui.bind($('staffDetail'));unbindStaffLog=ui.bind($('staffLogPane'));
  }
  function status(){
    const required=currentView==='notes'?['siteMemos','siteMemoComments']:['staffProfiles','staffNotes'];
    const error=required.some(key=>states[key]==='error');
    $('status').hidden=authReady&&!error&&required.every(key=>states[key]==='ready');
    $('status').className='status'+(error?' error':'');
    $('status').textContent=error?'読み込めませんでした。時間をおいて再度開いてください。':'読み込み中…';
    $('notesView').hidden=currentView!=='notes'||!authReady;
    $('staffView').hidden=currentView!=='staff'||!authReady;
    $('staffAdd').disabled=!authReady||states.staffProfiles!=='ready'||adding;
    $('staffAddMobile').disabled=$('staffAdd').disabled;
  }
  function showView(view){currentView=view;ui.resetConfirmation();$('navNotes').setAttribute('aria-pressed',String(view==='notes'));$('navStaff').setAttribute('aria-pressed',String(view==='staff'));status();if(view==='staff')renderStaff();else render();}
  $('navNotes').addEventListener('click',()=>showView('notes'));
  $('navStaff').addEventListener('click',()=>showView('staff'));
  function chooseProject(tag){currentProject=tag;ui.resetConfirmation();render(true);}
  function renderProjects(){
    const projects=[...new Set(W.TAGS.concat(records.siteMemos.map(n=>n.projectTag),[currentProject]))];
    $('projectList').replaceChildren();$('projectSelect').replaceChildren();
    projects.forEach(tag=>{
      const entries=records.siteMemos.filter(n=>n.projectTag===tag);
      const count=entries.length;
      // Same pin as on the memo itself, so a fresh addition is visible from the project list without opening it.
      const freshest=entries.reduce((latest,n)=>!latest||n.createdAt>latest?n.createdAt:latest,'');const pin=W.pinBadge(freshest);
      const b=document.createElement('button');b.type='button';b.className='project-button';b.setAttribute('aria-pressed',String(tag===currentProject));b.innerHTML='<span class="project-name">'+E(W.labelTag(tag))+(pin?' '+pin:'')+'</span><span class="project-count">'+(states.siteMemos==='ready'?count+'件':'—')+'</span>';b.addEventListener('click',()=>chooseProject(tag));$('projectList').append(b);
      const opt=document.createElement('option');opt.value=tag;opt.textContent=W.labelTag(tag)+(states.siteMemos==='ready'?'（'+count+'件）':'');$('projectSelect').append(opt);
    });$('projectSelect').value=currentProject;
  }
  $('projectSelect').addEventListener('change',e=>chooseProject(e.target.value));
  $('noteSort').addEventListener('change',()=>renderHistory());
  function renderHistory(force=false){
    const order=$('noteSort').value;
    const full=W.sortMemos(records.siteMemos.filter(n=>n.projectTag===currentProject),order);
    const collapsed=full.length>10&&!ui.isThreadExpanded('memolist',currentProject),list=collapsed?full.slice(0,10):full;
    const content=(collapsed?ui.moreButton('memolist',currentProject,full.length-list.length):'')+list.map(n=>ui.memo(n,order)).join('')+ui.orphanMemos(currentProject);
    W.replaceContent($('history'), content?'<div class="note-history">'+content+'</div>':'<div class="note-empty">'+(states.siteMemos==='ready'?'<strong>まだ記録はありません</strong>':'読み込み中です…')+'</div>',!force);
  }
  function render(force=false){$('projectHeading').textContent=W.labelTag(currentProject);renderProjects();renderHistory(force);}
  function chooseStaff(id){currentStaffId=id;ui.resetConfirmation();renderStaff(true);}
  function renderStaffList(){
    const list=records.staffProfiles.slice().sort((a,b)=>a.name.localeCompare(b.name,'ja'));
    $('staffList').replaceChildren();$('staffSelect').replaceChildren();
    list.forEach(p=>{const b=document.createElement('button');b.type='button';b.className='project-button';b.setAttribute('aria-pressed',String(p.id===currentStaffId));b.innerHTML='<span class="project-name">'+E(p.name||'（名前未設定）')+'</span>';b.addEventListener('click',()=>chooseStaff(p.id));$('staffList').append(b);const opt=document.createElement('option');opt.value=p.id;opt.textContent=p.name||'（名前未設定）';$('staffSelect').append(opt);});
    if(currentStaffId)$('staffSelect').value=currentStaffId;
  }
  $('staffSelect').addEventListener('change',e=>chooseStaff(e.target.value));
  $('staffLogSort').addEventListener('change',()=>{staffLogOrder=$('staffLogSort').value;renderStaff(true);});
  async function addStaff(){
    if(adding||!authReady||states.staffProfiles!=='ready')return;
    const session=generation;adding=true;status();
    try{const data={name:'新しい外注さん',profile:'',currentWork:'',updatedAt:new Date().toISOString()};const ref=await db.collection('staffProfiles').add(data);if(session!==generation)return;currentStaffId=ref.id;
      if(!records.staffProfiles.some(p=>p.id===ref.id))records.staffProfiles.push(W.normalizeStaff({id:ref.id,data:()=>data}));
      ui.startEdit('staff',ref.id);renderStaff(true);
    }catch(err){if(session===generation){$('status').hidden=false;$('status').className='status error';$('status').textContent=W.message(err);}}
    finally{if(session===generation){adding=false;$('staffAdd').disabled=false;$('staffAddMobile').disabled=false;}}
  }
  $('staffAdd').addEventListener('click',addStaff);$('staffAddMobile').addEventListener('click',addStaff);
  function renderStaff(force=false){
    let p=records.staffProfiles.find(p=>p.id===currentStaffId);
    if(!p&&currentStaffId)p=ui.editingRecord('staff',currentStaffId);
    if(!p){p=records.staffProfiles.slice().sort((a,b)=>a.name.localeCompare(b.name,'ja'))[0];currentStaffId=p?p.id:null;}
    renderStaffList();
    if(!p){W.replaceContent($('staffDetail'),'<div class="note-empty">'+(states.staffProfiles==='ready'?'<strong>まだ外注さんが登録されていません</strong><p>「＋」から追加してください。</p>':'読み込み中です…')+'</div>',!force);W.replaceContent($('staffLog'),'',!force);W.replaceContent($('staffLogActions'),'',!force);return;}
    const present=records.staffProfiles.some(r=>r.id===p.id), next=dateState.get(p.id)||{}, disabled=!authReady||states.staffProfiles!=='ready'||next.busy||!present;
    const nextRow='<div class="staff-next"><label for="staffNextDate">次回依頼日</label><input type="date" id="staffNextDate" value="'+E(next.busy?next.value:p.nextRequestDate||'')+'" data-id="'+E(p.id)+'"'+(disabled?' disabled':'')+'>'+ '<button type="button" class="next-clear" data-next-clear="'+E(p.id)+'"'+(disabled?' disabled':'')+'>クリア</button><span class="saved-flag"'+(next.saved?'':' hidden')+'>保存しました</span>'+(next.error?'<span class="form-msg" role="alert">'+E(next.error)+'</span>':'')+'</div>';
    const updated=p.updatedAt?W.createdDay(p.updatedAt):'';
    // Edit/delete sit next to the name itself instead of a separate row far below the content.
    const headActions='<span class="row-actions"><button type="button" data-wb-action="edit" data-kind="staff" data-id="'+E(p.id)+'"'+(!present||!authReady||states.staffProfiles!=='ready'?' disabled':'')+'>編集</button><button type="button" data-wb-action="delete" data-kind="staff" data-id="'+E(p.id)+'"'+(!present||!authReady||states.staffProfiles!=='ready'||ui.isDeleting(p.id)?' disabled':'')+'>'+(ui.isArmed(p.id)?'本当に削除？もう一度クリック':'削除')+'</button></span>';
    const errorMsg=ui.errorFor(p.id)?'<div class="form-msg" role="alert">'+E(ui.errorFor(p.id))+'</div>':'';
    const body=ui.hasEditor('staff',p.id)?'<div class="staff-profile">'+ui.form('staff',p.id)+'</div>':'<div class="staff-profile"><div class="staff-name-row"><div class="staff-name">'+E(p.name||'（名前未設定）')+'</div>'+headActions+'</div>'+errorMsg+'<div class="staff-section"><div class="staff-section-label">プロフィール</div><p class="project-note-text">'+E(p.profile||'（未入力）')+'</p></div><div class="staff-section"><div class="staff-section-label">依頼している内容</div><p class="project-note-text">'+E(p.currentWork||'（未入力）')+'</p></div>'+(updated?'<p class="staff-updated">最終更新：'+E(updated)+'</p>':'')+'</div>';
    W.replaceContent($('staffDetail'),nextRow+body,!force);
    W.replaceContent($('staffLogActions'),ui.composeTrigger('staffnote',p.id),!force);
    W.replaceContent($('staffLog'),ui.thread('staffnote',p.id,staffLogOrder),!force);
  }
  async function saveStaffNextDate(id,value){
    const p=records.staffProfiles.find(p=>p.id===id);if(!p||!authReady||states.staffProfiles!=='ready'||dateState.get(id)?.busy)return;
    const session=generation, item={busy:true,value,error:'',saved:false};dateState.set(id,item);clearTimeout(dateTimers.get(id));renderStaff(true);
    try{await db.doc('staffProfiles/'+id).updateChecked({nextRequestDate:value||null},{nextRequestDate:p._raw.nextRequestDate});if(session!==generation)return;item.saved=true;dateTimers.set(id,setTimeout(()=>{item.saved=false;dateTimers.delete(id);if(currentStaffId===id)renderStaff();},2000));}
    catch(err){if(session===generation)item.error=W.message(err);}
    finally{if(session===generation){item.busy=false;renderStaff(true);}}
  }
  $('staffDetail').addEventListener('change',e=>{if(e.target.id==='staffNextDate')void saveStaffNextDate(e.target.dataset.id,e.target.value);});
  $('staffDetail').addEventListener('click',e=>{const b=e.target.closest('[data-next-clear]');if(b&&!b.disabled)void saveStaffNextDate(b.dataset.nextClear,'');});
  function stopData(){generation++;disposers.splice(0).forEach(stop=>stop());dateTimers.forEach(clearTimeout);dateTimers.clear();dateState.clear();adding=false;}
  function connectData(){
    stopData();const session=generation;
    const normalizers={siteMemos:W.normalizeMemo,siteMemoComments:doc=>W.normalizeComment(doc,'memoId'),staffProfiles:W.normalizeStaff,staffNotes:doc=>W.normalizeComment(doc,'staffId')};
    collections.forEach(key=>{
      states[key]='loading';let timer=setTimeout(()=>{if(session===generation){states[key]='error';status();}},12000);disposers.push(()=>clearTimeout(timer));
      disposers.push(db.collection(key).onSnapshot(snap=>{if(session!==generation)return;clearTimeout(timer);records[key]=snap.docs.map(normalizers[key]);states[key]='ready';status();if(currentView==='notes')render();else renderStaff();},()=>{if(session!==generation)return;clearTimeout(timer);states[key]='error';status();if(currentView==='notes')renderHistory();else renderStaff();}));
    });status();
  }
  createUI();
  const stopAuth=auth.onAuthStateChanged(user=>{
    if(user){if(activeUid===user.uid&&authReady)return;activeUid=user.uid;authReady=true;createUI();connectData();return;}
    activeUid=null;authReady=false;stopData();collections.forEach(key=>{records[key]=[];states[key]='loading';});createUI();status();
    // Reuse an existing Google/anonymous session; never replace another tab's login.
    if(!signingIn){signingIn=true;auth.signInAnonymously().catch(err=>{$('status').hidden=false;$('status').className='status error';$('status').textContent='接続できませんでした。時間をおいて再度開いてください。';}).finally(()=>{signingIn=false;});}
  });
  window.addEventListener('pagehide',()=>{authReady=false;stopAuth();stopData();unbindHistory();unbindStaff();unbindStaffLog();ui.dispose();});
  window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
})();

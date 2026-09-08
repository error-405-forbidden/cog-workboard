(function (W) {
  'use strict';
  const E = W.esc;
  const definitions = {
    memo:{collection:'siteMemos', fields:[{key:'date', type:'date', label:'記録日', row:true}, {key:'author', label:'記入者', fallback:'未設定', row:true}, {key:'text', type:'textarea', label:'本文', required:true}]},
    staff:{collection:'staffProfiles', fields:[{key:'name', label:'お名前', required:true, className:'staff-name-input'}, {key:'profile', type:'textarea', label:'プロフィール（スキル・稼働時間・レートなど）', showLabel:true, labelClass:'profile-label', className:'profile-input'}, {key:'currentWork', type:'textarea', label:'依頼している内容', showLabel:true}], stamp:'updatedAt'},
    log:{collection:'staffNotes', fields:[{key:'author', label:'お名前', fallback:'匿名'}, {key:'text', type:'textarea', label:'内容', required:true}]}
  };
  const threads = {
    comment:{collection:'siteMemoComments', parent:'siteMemos', foreignKey:'memoId', openLabel:'コメントする', placeholder:'コメントを入力'},
    staffnote:{collection:'staffNotes', parent:'staffProfiles', foreignKey:'staffId', openLabel:'ログを追加', placeholder:'ログを入力（いつ何を依頼した、連絡した、など）'}
  };
  function button(action, kind, id, text, primary = false, disabled = false) {
    return '<button type="button" data-wb-action="'+action+'" data-kind="'+kind+'" data-id="'+E(id)+'" data-focus-key="'+E(action+':'+kind+':'+id)+'"'+(primary?' class="primary"':'')+(disabled?' disabled':'')+'>'+text+'</button>';
  }
  // One editor/composer implementation for memos, profiles, staff logs and replies.
  W.createRecordsUI = options => {
    const editors = new Map(), composers = new Map(), errors = new Map(), deleting = new Set(), expandedThreads = new Set(), expandedText = new Set();
    let disposed = false;
    const changed = (force = false) => { if (!disposed) options.render(force); };
    const canWrite = collection => !disposed && options.canWrite(collection);
    const arm = W.createDeleteArm(() => changed());
    const key = (kind, id) => kind + ':' + id;
    const getRecord = (collection, id) => options.records(collection).find(r => r.id === id);
    function startEdit(kind, id) {
      const definition = definitions[kind], record = getRecord(definition.collection, id);
      if (!record || !canWrite(definition.collection)) return;
      const k = key(kind, id);
      if (!editors.has(k)) {
        const initial = Object.fromEntries(definition.fields.map(f => [f.key, String(record[f.key] || '')]));
        editors.set(k, {id, kind, initial, draft:{...initial}, base:{...(record._raw || record)}, record, version:0, busy:false, msg:''});
      }
      arm.reset(); changed(true);
    }
    function input(kind, id, field, value, compose = false) {
      const item = (compose ? composers : editors).get(key(kind, id));
      if (item && !item.busy) item.draft[field] = value;
    }
    async function saveEdit(kind, id) {
      const k = key(kind, id), item = editors.get(k), definition = definitions[kind];
      if (!item || item.busy || !canWrite(definition.collection)) return;
      const patch = {}, base = {};
      for (const field of definition.fields) {
        const value = String(item.draft[field.key] || '').trim();
        if (field.required && !value) { item.msg = field.label+'を入力してください。'; changed(true); return; }
        if (item.draft[field.key] !== item.initial[field.key]) {
          patch[field.key] = value || field.fallback || '';
          base[field.key] = item.base[field.key];
        }
      }
      if (!Object.keys(patch).length) { editors.delete(k); changed(true); return; }
      if (definition.stamp) patch[definition.stamp] = new Date().toISOString();
      item.busy = true; item.version++; item.msg = ''; changed(true);
      try {
        await options.db().doc(definition.collection+'/'+id).updateChecked(patch, base);
        if (editors.get(k) === item) editors.delete(k);
      } catch (err) { item.msg = W.message(err); }
      finally { item.busy = false; item.version++; changed(); }
    }
    function openComposer(kind, id) {
      const config = threads[kind];
      if (!canWrite(config.collection) || !getRecord(config.parent, id)) return;
      const k = key(kind, id);
      if (!composers.has(k)) composers.set(k, {id, kind, draft:{text:'', author:options.author ? options.author() : ''}, version:0, busy:false, msg:'', open:true});
      composers.get(k).open = true; changed(true);
    }
    async function submit(kind, id) {
      const k = key(kind, id), item = composers.get(k), config = threads[kind];
      if (!item || item.busy || !canWrite(config.collection)) return;
      const text = item.draft.text.trim();
      if (!text) { item.msg = '内容を入力してください。'; changed(true); return; }
      if (!getRecord(config.parent, id)) { item.msg = '元の記録は削除されています。入力内容を控えてください。'; changed(true); return; }
      item.busy = true; item.version++; item.msg = ''; changed(true);
      try {
        await options.db().collection(config.collection).add({[config.foreignKey]:id, text, author:item.draft.author.trim() || '匿名', createdAt:new Date().toISOString()});
        if (composers.get(k) === item) composers.delete(k);
      } catch (err) { item.msg = W.message(err); }
      finally { item.busy = false; item.version++; changed(); }
    }
    async function removeLog(id) {
      if (!canWrite('staffNotes') || deleting.has(id)) return;
      if (!arm.press(id)) return;
      deleting.add(id); errors.delete(id); changed(true);
      try { await options.db().doc('staffNotes/'+id).delete(); editors.delete(key('log', id)); }
      catch (err) { errors.set(id, W.message(err)); }
      finally { deleting.delete(id); changed(); }
    }
    async function removeStaff(id) {
      if (!canWrite('staffProfiles') || deleting.has(id)) return;
      if (!arm.press(id)) return;
      deleting.add(id); errors.delete(id); changed(true);
      try { await options.db().doc('staffProfiles/'+id).delete(); editors.delete(key('staff', id)); }
      catch (err) { errors.set(id, W.message(err)); }
      finally { deleting.delete(id); changed(); }
    }
    function form(kind, id) {
      const item = editors.get(key(kind, id)); if (!item) return '';
      const definition = definitions[kind];
      const disabled = item.busy || !canWrite(definition.collection);
      function field(f) {
        const attrs = ' data-wb-field="'+f.key+'" data-kind="'+kind+'" data-id="'+E(id)+'" data-focus-key="'+E(kind+':'+id+':'+f.key)+'" aria-label="'+E(f.label)+'"'+(disabled?' disabled':'')+(f.className?' class="'+f.className+'"':'');
        return (f.showLabel?'<div class="staff-section-label'+(f.labelClass?' '+f.labelClass:'')+'">'+E(f.label)+'</div>':'')+(f.type==='textarea'?'<textarea'+attrs+' placeholder="'+E(f.label)+'">'+E(item.draft[f.key])+'</textarea>':'<input type="'+(f.type||'text')+'"'+attrs+' placeholder="'+E(f.label)+'" value="'+E(item.draft[f.key])+'">');
      }
      const rows = definition.fields.filter(f => f.row), rest = definition.fields.filter(f => !f.row);
      const missing = !getRecord(definition.collection, id);
      return '<div class="edit-form" data-draft-key="'+E(key(kind,id))+'" data-draft-version="'+item.version+'">'+(rows.length?'<div class="edit-form-row">'+rows.map(field).join('')+'</div>':'')+rest.map(field).join('')+(missing?'<div class="form-msg">この記録は削除されています。入力内容を控えてから閉じてください。</div>':'')+(item.msg?'<div class="form-msg" role="alert">'+E(item.msg)+'</div>':'')+'<div class="edit-form-foot">'+button('cancel',kind,id,'キャンセル',false,item.busy)+button('save',kind,id,item.busy?'保存中…':'保存',true,disabled||missing)+'</div></div>';
    }
    const THREAD_COLLAPSE_AT = 10, TEXT_COLLAPSE_AT = 60;
    function expandThread(kind, id) { expandedThreads.add(key(kind, id)); changed(true); }
    function expandText(kind, id) { expandedText.add(key(kind, id)); changed(true); }
    function collapseText(kind, id) { expandedText.delete(key(kind, id)); changed(true); }
    function moreButton(kind, id, remaining) { return '<div class="note-actions">'+button('thread-more',kind,id,'さらに表示（残り'+remaining+'件）')+'</div>'; }
    // The compose-open trigger renders wherever the caller wants it (typically next to a
    // name/heading, not buried below a thread) — nothing to show while the composer is already open.
    function composeTrigger(kind, id) {
      const config = threads[kind];
      const item = composers.get(key(kind, id));
      if (item && item.open) return '';
      return button('compose', kind, id, config.openLabel, false, !canWrite(config.collection));
    }
    // Long memo/log bodies clamp to two lines via CSS (word/line-boundary aware,
    // unlike a fixed character cut) with a 続きを見る toggle; each entry tracks its own state.
    function truncatedBody(kind, id, text) {
      const long = text.length > TEXT_COLLAPSE_AT, expanded = expandedText.has(key(kind, id));
      const span = '<span'+(long && !expanded ? ' class="text-clamp"' : '')+'>'+E(text)+'</span>';
      return span+(long?' '+button(expanded?'text-less':'text-more',kind,id,expanded?'閉じる':'続きを見る'):'');
    }
    function thread(kind, parentId, order = 'newest') {
      const config = threads[kind], full = W.sortThread(options.records(config.collection).filter(r => r[config.foreignKey] === parentId), order);
      const tk = key(kind, parentId), collapsed = full.length > THREAD_COLLAPSE_AT && !expandedThreads.has(tk);
      // Collapsed view always favors the most recent entries; which end of the sorted
      // array that is — and which side the "さらに表示" button sits on — depends on order.
      const newestFirst = order !== 'oldest';
      const list = collapsed ? (newestFirst ? full.slice(0, THREAD_COLLAPSE_AT) : full.slice(-THREAD_COLLAPSE_AT)) : full;
      const more = collapsed ? moreButton(kind,parentId,full.length-list.length) : '';
      let html = '<div class="comments">'
        +(collapsed && !newestFirst ? more : '')
        +list.map(c => {
        if (kind==='staffnote' && editors.has(key('log',c.id))) return '<div class="comment">'+form('log',c.id)+'</div>';
        const rowActions = kind==='staffnote' ? '<span class="row-actions">'+button('edit','log',c.id,'編集',false,!canWrite(config.collection))+button('delete','log',c.id,arm.isArmed(c.id)?'本当に削除？もう一度クリック':'削除',false,deleting.has(c.id)||!canWrite(config.collection))+'</span>' : '';
        return '<div class="comment"><div class="comment-head"><strong>'+E(c.author)+'</strong><span>'+E(W.createdDay(c.createdAt))+'</span>'+rowActions+'</div><div class="comment-text">'+truncatedBody(kind,c.id,c.text)+'</div>'+(errors.has(c.id)?'<div class="form-msg" role="alert">'+E(errors.get(c.id))+'</div>':'')+'</div>';
      }).join('')
        +(collapsed && newestFirst ? more : '');
      // A remotely deleted record must not silently discard an open edit draft.
      for (const item of editors.values()) if (item.kind==='log' && kind==='staffnote' && item.record.staffId===parentId && !getRecord('staffNotes',item.id)) html += '<div class="comment">'+form('log',item.id)+'</div>';
      if (!options.loaded(config.collection)) html += '<div class="thread-status">'+E(options.error && options.error(config.collection) ? '読み込めませんでした。再読み込みしてください。' : '読み込み中…')+'</div>';
      const item = composers.get(key(kind,parentId));
      if (item && item.open) {
        const disabled = item.busy || !canWrite(config.collection);
        const attrs = ' data-kind="'+kind+'" data-id="'+E(parentId)+'"'+(disabled?' disabled':'');
        html += '<div class="comment-form" data-draft-key="'+E(key(kind,parentId))+'" data-draft-version="'+item.version+'">'+'<input type="text" data-wb-compose="author"'+attrs+' placeholder="お名前" aria-label="お名前" value="'+E(item.draft.author)+'">'+'<textarea data-wb-compose="text"'+attrs+' placeholder="'+E(config.placeholder)+'" aria-label="'+E(config.placeholder)+'">'+E(item.draft.text)+'</textarea>'+(item.msg?'<div class="form-msg" role="alert">'+E(item.msg)+'</div>':'')+'<div class="comment-form-foot">'+button('compose-cancel',kind,parentId,'キャンセル',false,item.busy)+button('submit',kind,parentId,item.busy?'送信中…':'送信',true,disabled)+'</div></div>';
      }
      return html+'</div>';
    }
    function memo(record, order) {
      const editing = editors.has(key('memo',record.id));
      const created = W.createdDay(record.createdAt), recorded = created && created!==record.date ? '<p class="note-recorded">追記日：'+E(created)+'</p>' : '';
      const headActions = editing ? '' : '<span class="row-actions">'+button('edit','memo',record.id,'編集',false,!canWrite('siteMemos'))+composeTrigger('comment',record.id)+'</span>';
      const body = editing ? form('memo',record.id) : '<p class="project-note-text">'+truncatedBody('memo',record.id,record.text)+'</p>'+recorded;
      return '<article class="project-note"><div class="project-note-head"><time datetime="'+E(record.date)+'">'+E(record.date||'日付未設定')+'</time><span>'+E(record.author)+'</span>'+headActions+'</div>'+body+thread('comment',record.id,order)+'</article>';
    }
    function orphanMemos(project) {
      let html = '';
      for (const item of editors.values()) if (item.kind==='memo' && item.record.projectTag===project && !getRecord('siteMemos',item.id)) html += '<article class="project-note">'+form('memo',item.id)+'</article>';
      // Reply drafts survive a parent being deleted as well.
      for (const item of composers.values()) if (item.kind==='comment' && item.open && !getRecord('siteMemos',item.id)) html += '<article class="project-note"><div class="form-msg">元のメモは削除されています。入力内容を控えてください。</div>'+thread('comment',item.id)+'</article>';
      return html;
    }
    function bind(root) {
      const onInput = event => {
        const t = event.target;
        if (t.dataset.wbField) input(t.dataset.kind,t.dataset.id,t.dataset.wbField,t.value);
        if (t.dataset.wbCompose) input(t.dataset.kind,t.dataset.id,t.dataset.wbCompose,t.value,true);
      };
      const onClick = event => {
        const b = event.target.closest('[data-wb-action]'); if (!b || !root.contains(b) || b.disabled) return;
        const {wbAction:action,kind,id} = b.dataset;
        if (action==='edit') startEdit(kind,id);
        else if (action==='save') void saveEdit(kind,id);
        else if (action==='cancel') { const item=editors.get(key(kind,id)); if(item&&!item.busy){editors.delete(key(kind,id));arm.reset();changed(true);} }
        else if (action==='compose') openComposer(kind,id);
        else if (action==='submit') void submit(kind,id);
        else if (action==='compose-cancel') { const item=composers.get(key(kind,id));if(item&&!item.busy){item.open=false;changed(true);} }
        else if (action==='delete') { if (kind==='staff') void removeStaff(id); else void removeLog(id); }
        else if (action==='thread-more') expandThread(kind,id);
        else if (action==='text-more') expandText(kind,id);
        else if (action==='text-less') collapseText(kind,id);
      };
      root.addEventListener('input',onInput); root.addEventListener('change',onInput); root.addEventListener('click',onClick);
      return () => { root.removeEventListener('input',onInput);root.removeEventListener('change',onInput);root.removeEventListener('click',onClick); };
    }
    return {bind,memo,thread,form,orphanMemos,startEdit,saveEdit,input,openComposer,submit,removeLog,removeStaff,expandThread,expandText,collapseText,moreButton,composeTrigger,
      hasEditor:(kind,id)=>editors.has(key(kind,id)),
      editingRecord:(kind,id)=>editors.get(key(kind,id))?.record,
      resetConfirmation:()=>arm.reset(),
      isArmed:id=>arm.isArmed(id),
      isDeleting:id=>deleting.has(id),
      errorFor:id=>errors.get(id),
      isThreadExpanded:(kind,id)=>expandedThreads.has(key(kind,id)),
      dispose:()=>{disposed=true;arm.dispose();editors.clear();composers.clear();errors.clear();expandedThreads.clear();expandedText.clear();},
      // Exposed read-only references are useful to dependency-free unit tests.
      drafts:editors,composers
    };
  };
})(Workboard);

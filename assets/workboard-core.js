(function (global) {
  'use strict';
  const W = global.Workboard = {};
  W.TAGS = ['ジムセレ', '買取サファリ', '金融メディアサイト群', '自社サイト', '共通/インフラ', 'その他'];
  W.esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  W.canonicalProject = tag => tag === '共通・インフラ' ? '共通/インフラ' : String(tag || 'その他');
  W.labelTag = tag => tag === '共通/インフラ' ? '共通・インフラ' : tag;
  W.isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
  W.dateStr = (date = new Date()) => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  W.createdDay = timestamp => { const d = new Date(timestamp); return Number.isNaN(d.getTime()) ? '' : W.dateStr(d); };
  W.toMD = value => { const s = W.isoDay(value); return s ? Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10)) : ''; };
  W.isNewToday = value => !!value && W.createdDay(value) === W.dateStr();
  // Shared "added today" pin — used both on a memo itself and on the project-list
  // entry that contains it, so a fresh addition is visible without opening it.
  W.pinBadge = value => W.isNewToday(value) ? '<span class="pin-badge">【' + W.toMD(value) + '】</span>' : '';
  W.equal = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
  W.failure = (code, message) => Object.assign(new Error(message), {code});
  W.message = err => err && ['conflict', 'missing'].includes(err.code) ? err.message : '保存できませんでした。入力内容は残っています。接続を確認して再度お試しください。';
  W.normalizeMemo = doc => {
    const raw = doc.data() || {};
    return {...raw, _raw:raw, id:doc.id, projectTag:W.canonicalProject(raw.projectTag), text:String(raw.text || ''), date:W.isoDay(raw.date) || W.createdDay(raw.createdAt), author:String(raw.author || '未設定'), createdAt:String(raw.createdAt || '')};
  };
  W.normalizeComment = (doc, foreignKey) => {
    const raw = doc.data() || {};
    return {...raw, _raw:raw, id:doc.id, [foreignKey]:String(raw[foreignKey] || ''), text:String(raw.text || ''), author:String(raw.author || '匿名'), createdAt:String(raw.createdAt || '')};
  };
  W.normalizeStaff = doc => {
    const raw = doc.data() || {};
    return {...raw, _raw:raw, id:doc.id, name:String(raw.name || ''), profile:String(raw.profile || ''), currentWork:String(raw.currentWork || ''), nextRequestDate:W.isoDay(raw.nextRequestDate), updatedAt:String(raw.updatedAt || '')};
  };
  W.sortMemos = (list, order = 'newest') => {
    const sorted = list.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return order === 'oldest' ? sorted : sorted.reverse();
  };
  W.sortThread = (list, order = 'newest') => {
    const sorted = list.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return order === 'oldest' ? sorted : sorted.reverse();
  };

  // The only RTDB adapter. Both pages use the same collection/document interface.
  W.createDb = rtdb => {
    const snapshot = snap => ({docs:Object.entries(snap.val() || {}).map(([id, value]) => ({id, data:() => value}))});
    function doc(path) {
      const ref = rtdb.ref(path);
      async function mutate(change) {
        // Prime the cache: RTDB transactions may initially receive null locally.
        await ref.once('value');
        let aborted;
        const result = await ref.transaction(current => {
          aborted = undefined;
          try { return change(current); }
          catch (err) { aborted = err; return undefined; }
        }, undefined, false);
        if (!result.committed) throw aborted || W.failure('conflict', '別の操作で更新されました。開き直して内容を確認してください。');
        return result.snapshot.val();
      }
      return {
        get:() => ref.once('value').then(snap => ({id:ref.key, data:() => snap.val()})),
        update:patch => ref.update(patch),
        delete:() => ref.remove(),
        mutate,
        updateChecked:(patch, base) => mutate(current => {
          if (!current) throw W.failure('missing', 'この記録は削除されています。入力内容を控えてから閉じてください。');
          for (const key of Object.keys(base)) {
            if (!W.equal(current[key], base[key])) throw W.failure('conflict', '同じ項目が別の操作で更新されました。入力内容を控え、一度キャンセルして開き直してください。');
          }
          return {...current, ...patch};
        }),
        createIfAbsent:async data => {
          let created = false;
          await mutate(current => { created = !current; return current || data; });
          return created;
        }
      };
    }
    return {
      doc,
      collection:path => {
        const ref = rtdb.ref(path);
        return {
          add:async data => { const child = ref.push(); await child.set(data); return {id:child.key, key:child.key}; },
          get:() => ref.once('value').then(snapshot),
          onSnapshot:(next, error) => {
            let active = true;
            const handler = snap => { if (active) next(snapshot(snap)); };
            ref.on('value', handler, err => { if (active && error) error(err); });
            return () => { active = false; ref.off('value', handler); };
          }
        };
      }
    };
  };

  // Disposable confirmation state shared by task deletion, samples and staff logs.
  W.createDeleteArm = (changed = () => {}, timers = global) => {
    let key = null, timer = null, disposed = false;
    const reset = () => { if (timer != null) timers.clearTimeout(timer); timer = null; key = null; if (!disposed) changed(); };
    return {
      isArmed:target => key === target,
      press:target => {
        if (disposed) return false;
        if (key === target) { reset(); return true; }
        reset(); key = target; timer = timers.setTimeout(reset, 4000); changed(); return false;
      },
      reset,
      dispose:() => { disposed = true; reset(); }
    };
  };

  // Keep input nodes (including composition/caret state) in the DOM during live updates.
  // Use only for a live refresh; explicit save/cancel renders a fresh form.
  W.replaceContent = (root, html, preserve = true) => {
    const retained = preserve ? [...root.querySelectorAll('[data-draft-key]')] : [];
    const active = document.activeElement;
    const focusKey = active && root.contains(active) ? active.getAttribute('data-focus-key') : null;
    // Defer replacement while a live field is focused, so Japanese composition
    // is never interrupted. Blur applies the most recent queued snapshot.
    if (preserve && active && root.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
      root._pendingMarkup = html;
      if (!root._pendingBlur) {
        root._pendingBlur = true;
        root.addEventListener('focusout', () => {
          global.setTimeout(() => {
            if (root._pendingMarkup != null && !root.contains(document.activeElement)) {
              const pending = root._pendingMarkup; root._pendingMarkup = null; W.replaceContent(root, pending, true);
            }
          }, 0);
        });
      }
      return;
    }
    const template = document.createElement('template'); template.innerHTML = html;
    retained.forEach(old => {
      const replacement = [...template.content.querySelectorAll('[data-draft-key]')].find(n => n.dataset.draftKey === old.dataset.draftKey);
      if (replacement && replacement.dataset.draftVersion === old.dataset.draftVersion) replacement.replaceWith(old);
    });
    root._pendingMarkup = null;
    root.replaceChildren(template.content);
    if (focusKey) {
      const target = [...root.querySelectorAll('[data-focus-key]')].find(n => n.getAttribute('data-focus-key') === focusKey);
      if (target) target.focus({preventScroll:true});
    }
  };
})(typeof window === 'undefined' ? globalThis : window);

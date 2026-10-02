(function (W) {
  'use strict';
  // WordPress-dashboard style box layout, shared by everyone.
  //
  // Each screen has one root: <div data-layout="name" data-widths="220px|1fr|1.6fr">
  // holding .lay-box[data-box][data-title] elements in their default order, with
  // data-col on each box naming its default column. The order of boxes in each
  // column is stored for everyone at layout/<name> = {cols:"a,b|c|d", updatedAt}
  // (a string, because RTDB drops empty arrays). Boxes are only draggable while
  // 「配置を編集」 is on, so nobody rearranges everyone's screen by accident.
  // Collapsing a box (▲/▼) is per-browser only.
  const COLLAPSE_KEY = 'wb_layout_collapsed_v1';
  W.parseLayout = (value, defaults) => {
    const known = new Set(defaults.flat()), seen = new Set();
    const cols = defaults.map(() => []);
    if (typeof value === 'string') {
      value.split('|').slice(0, defaults.length).forEach((col, i) => {
        for (const id of col.split(',')) if (known.has(id) && !seen.has(id)) { seen.add(id); cols[i].push(id); }
      });
    }
    // Boxes added to the page after the layout was saved go to their default column.
    defaults.forEach((col, i) => { for (const id of col) if (!seen.has(id)) { seen.add(id); cols[i].push(id); } });
    return cols;
  };
  W.serializeLayout = cols => cols.map(col => col.join(',')).join('|');

  W.createLayout = ({editButton, resetButton, statusEl}) => {
    const screens = [...document.querySelectorAll('[data-layout]')].map(root => {
      const widths = root.dataset.widths.split('|');
      const boxes = [...root.querySelectorAll(':scope > .lay-box')];
      const defaults = widths.map((_, i) => boxes.filter(b => Number(b.dataset.col || 0) === i).map(b => b.dataset.box));
      const columns = widths.map((_, i) => { const col = document.createElement('div'); col.className = 'lay-col'; col.dataset.colIndex = i; root.append(col); return col; });
      boxes.forEach((box, i) => {
        box.style.setProperty('--mobile-order', i);
        const bar = document.createElement('div'); bar.className = 'lay-bar';
        bar.innerHTML = '<span class="lay-handle" aria-hidden="true">⠿</span><span class="lay-title">'+W.esc(box.dataset.title)+'</span><button type="button" class="lay-toggle" aria-expanded="true" aria-label="'+W.esc(box.dataset.title)+'を折りたたむ">▲</button>';
        box.prepend(bar);
      });
      return {name:root.dataset.layout, root, widths, defaults, columns, boxes:new Map(boxes.map(b => [b.dataset.box, b])), saved:null};
    });
    let editing = false, db = null, stop = null, dragging = null, collapsed = {};
    try { collapsed = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch (e) { collapsed = {}; }

    function current(screen) { return screen.columns.map(col => [...col.children].map(b => b.dataset.box)); }
    function fitColumns(screen) {
      // Out of edit mode an empty column takes no space; while editing it stays as a drop zone.
      const used = screen.columns.map(col => editing || col.children.length > 0);
      screen.columns.forEach((col, i) => { col.hidden = !used[i]; });
      screen.root.style.gridTemplateColumns = screen.widths.filter((_, i) => used[i]).map(w => /^\d/.test(w) && !w.endsWith('px') ? 'minmax(0,'+w+')' : w).join(' ');
    }
    function apply(screen, cols) {
      cols.forEach((ids, i) => ids.forEach(id => screen.columns[i].append(screen.boxes.get(id))));
      fitColumns(screen);
    }
    function applyCollapsed(screen) {
      for (const [id, box] of screen.boxes) {
        const shut = !!(collapsed[screen.name] || {})[id];
        box.classList.toggle('lay-collapsed', shut);
        const t = box.querySelector(':scope > .lay-bar .lay-toggle');
        t.textContent = shut ? '▼' : '▲'; t.setAttribute('aria-expanded', String(!shut));
        t.setAttribute('aria-label', box.dataset.title + (shut ? 'を開く' : 'を折りたたむ'));
      }
    }
    function status(text, error = false) { if (!statusEl) return; statusEl.textContent = text || ''; statusEl.hidden = !text; statusEl.classList.toggle('error', error); }
    function syncButtons() {
      editButton.setAttribute('aria-pressed', String(editing));
      editButton.textContent = editing ? '配置の編集を終わる' : '配置を編集';
      editButton.disabled = !db;
      resetButton.hidden = !editing; resetButton.disabled = !db;
    }
    function setEditing(on) {
      editing = on && !!db;
      for (const screen of screens) {
        screen.root.classList.toggle('lay-editing', editing);
        for (const box of screen.boxes.values()) box.querySelector(':scope > .lay-bar').draggable = editing;
        fitColumns(screen);
      }
      if (!editing) status('');
      else status('箱の上の帯をドラッグして移動できます。変更は全員の画面に反映されます。');
      syncButtons();
    }
    async function save(screen) {
      const cols = current(screen), value = W.serializeLayout(cols);
      if (value === W.serializeLayout(screen.saved || screen.defaults)) return;
      try { await db.doc('layout/' + screen.name).update({cols:value, updatedAt:new Date().toISOString()}); status('配置を保存しました（全員に反映）'); }
      catch (err) { apply(screen, screen.saved || screen.defaults); status('配置を保存できませんでした。もう一度お試しください。', true); }
    }

    for (const screen of screens) {
      apply(screen, screen.defaults);
      applyCollapsed(screen);
      screen.root.addEventListener('click', e => {
        const t = e.target.closest('.lay-toggle'); if (!t || !screen.root.contains(t)) return;
        const id = t.closest('.lay-box').dataset.box;
        const state = collapsed[screen.name] = collapsed[screen.name] || {};
        if (state[id]) delete state[id]; else state[id] = true;
        try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed)); } catch (err) {}
        applyCollapsed(screen);
      });
      screen.root.addEventListener('dragstart', e => {
        const bar = e.target.closest && e.target.closest('.lay-bar');
        if (!editing || !bar || !screen.root.contains(bar)) return;
        dragging = {screen, box:bar.parentElement};
        dragging.box.classList.add('lay-dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragging.box.dataset.box); } catch (err) {}
      });
      screen.root.addEventListener('dragover', e => {
        if (!dragging || dragging.screen !== screen) return;
        const col = e.target.closest('.lay-col'); if (!col || !screen.root.contains(col)) return;
        e.preventDefault();
        // Live reorder: drop before the first box whose middle is below the pointer.
        const before = [...col.children].find(b => b !== dragging.box && e.clientY < b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2);
        if (before) { if (dragging.box.nextElementSibling !== before) col.insertBefore(dragging.box, before); }
        else if (col.lastElementChild !== dragging.box) col.append(dragging.box);
      });
      screen.root.addEventListener('drop', e => { if (dragging && dragging.screen === screen) e.preventDefault(); });
      screen.root.addEventListener('dragend', () => {
        if (!dragging || dragging.screen !== screen) return;
        dragging.box.classList.remove('lay-dragging'); dragging = null;
        fitColumns(screen); void save(screen);
      });
    }
    editButton.addEventListener('click', () => setEditing(!editing));
    resetButton.addEventListener('click', async () => {
      // Only the screen(s) currently on display go back to the default.
      for (const screen of screens) if (screen.root.offsetParent !== null) { apply(screen, screen.defaults); await save(screen); }
    });
    syncButtons();

    return {
      connect(database) {
        this.disconnect(); db = database; syncButtons();
        stop = db.collection('layout').onSnapshot(snap => {
          const byName = new Map(snap.docs.map(d => [d.id, d.data() || {}]));
          for (const screen of screens) {
            screen.saved = W.parseLayout(byName.get(screen.name)?.cols, screen.defaults);
            if (!dragging) apply(screen, screen.saved);
          }
        }, () => status('配置を読み込めませんでした（初期配置で表示しています）', true));
      },
      disconnect() { if (stop) stop(); stop = null; db = null; setEditing(false); }
    };
  };
})(Workboard);

/* ===== 白泽写作 v2 - 界面逻辑 ===== */
(function () {
  const $ = id => document.getElementById(id);
  const DB = window.DB;

  let curBookId = null;   // 当前书籍
  let curArticle = null;  // 当前章节
  let curGroupId = '';    // 书架当前分组筛选
  let saveTimer = null;
  let dirty = false;
  let editStartAt = 0;    // 本次编辑开始时间(算写作时长)

  /* ---------------- 通用 ---------------- */
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.add('hidden'), ms || 1900);
  }
  window.toast = toast;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtWords = n => n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(n || 0);

  function fmtDate(ts) {
    const d = new Date(ts), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function show(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $(view).classList.add('active');
    document.body.classList.remove('reading');
  }

  /* 抽屉 */
  function openSheet(title, html) {
    $('sheet-body').innerHTML = `<div class="sheet-title">${esc(title)}</div>${html}`;
    $('sheet-mask').classList.remove('hidden');
    $('sheet').classList.remove('hidden');
  }
  function closeSheet() {
    $('sheet-mask').classList.add('hidden');
    $('sheet').classList.add('hidden');
  }
  $('sheet-mask').addEventListener('click', closeSheet);

  /* 供 tools.js 复用 */
  window.UI = { openSheet, closeSheet, show, esc, fmtWords, toast };

  function confirmBox(msg) { return window.confirm(msg); }

  /* 封面色:统一中低明度 + 低饱和,白字压得住,彼此不打架 */
  const COVER_COLORS = [
    'linear-gradient(150deg,#2f6d66,#3e8a80)',
    'linear-gradient(150deg,#35506e,#46688c)',
    'linear-gradient(150deg,#5b4a78,#756096)',
    'linear-gradient(150deg,#8a5740,#a67153)',
    'linear-gradient(150deg,#3c6b4b,#528a64)',
    'linear-gradient(150deg,#7c3f48,#9a5661)',
    'linear-gradient(150deg,#7a6031,#99794a)',
    'linear-gradient(150deg,#3a4348,#545f66)',
  ];
  function coverOf(book) {
    let h = 0;
    for (const c of (book.id || '')) h = (h * 31 + c.charCodeAt(0)) % 997;
    return COVER_COLORS[h % COVER_COLORS.length];
  }

  /* 长按 */
  function bindLongPress(el, fn) {
    let timer = null, moved = false;
    el.addEventListener('touchstart', e => {
      moved = false;
      timer = setTimeout(() => { if (!moved) { fn(e); if (navigator.vibrate) navigator.vibrate(12); } }, 480);
    }, { passive: true });
    el.addEventListener('touchmove', () => { moved = true; clearTimeout(timer); }, { passive: true });
    el.addEventListener('touchend', () => clearTimeout(timer));
    el.addEventListener('touchcancel', () => clearTimeout(timer));
    el.addEventListener('contextmenu', e => { e.preventDefault(); fn(e); });
  }

  /* ================= 书架 ================= */
  function renderGroupBar() {
    const groups = DB.groups();
    let html = `<div class="chip ${curGroupId === '' ? 'active' : ''}" data-gid="">全部</div>`;
    groups.forEach(g => {
      const cnt = DB.books(g.id).filter(b => !b.flag).length;
      html += `<div class="chip ${curGroupId === g.id ? 'active' : ''}" data-gid="${g.id}">${esc(g.name)}${cnt ? ' ' + cnt : ''}</div>`;
    });
    html += `<div class="chip add" id="chip-add-group">＋ 分组</div>`;
    const bar = $('group-bar');
    bar.innerHTML = html;
    bar.querySelectorAll('.chip[data-gid]').forEach(c => {
      c.addEventListener('click', () => { curGroupId = c.dataset.gid; renderGroupBar(); renderShelf(); });
    });
    $('chip-add-group').addEventListener('click', addGroupFlow);
  }

  function addGroupFlow() {
    const name = prompt('新建分组名称:');
    if (!name || !name.trim()) return;
    DB.addGroup(name.trim());
    renderGroupBar(); renderShelf();
    toast('分组已创建');
  }

  function renderShelf() {
    let books = DB.books(curGroupId || null).filter(b => !b.flag);
    const sortBy = DB.settings().bookSort || 'update';
    if (sortBy === 'name') books = books.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
    else if (sortBy === 'words') books = books.slice().sort((a, b) => DB.bookWords(b.id) - DB.bookWords(a.id));
    const grid = $('book-grid');
    if (!books.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">书架空空如也<br>点右下角 ＋ 创建第一本书</div>`;
      return;
    }
    grid.innerHTML = books.map(b => {
      const words = DB.bookWords(b.id);
      const chs = DB.bookChapters(b.id).length;
      return `
        <div class="book-card" data-bid="${b.id}">
          <div class="book-cover" style="background:${coverOf(b)}"><span>${esc(b.name)}</span></div>
          <div class="book-name">${esc(b.name)}</div>
          <div class="book-words">${fmtWords(words)}字 · ${chs}章</div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.book-card').forEach(card => {
      const bid = card.dataset.bid;
      card.addEventListener('click', () => openCatalog(bid));
      bindLongPress(card, () => bookMenu(bid));
    });
  }

  function bookMenu(bid) {
    const b = DB.get('book', bid);
    if (!b) return;
    openSheet(b.name, `
      <div class="sheet-item" data-act="rename"><span class="si-icon">✏️</span>重命名</div>
      <div class="sheet-item" data-act="move"><span class="si-icon">📁</span>移到分组</div>
      <div class="sheet-item" data-act="export"><span class="si-icon">📤</span>导出全书 TXT</div>
      <div class="sheet-item danger" data-act="del"><span class="si-icon">🗑</span>删除书籍(进回收站)</div>
    `);
    $('sheet-body').querySelectorAll('.sheet-item').forEach(it => {
      it.addEventListener('click', () => {
        const act = it.dataset.act;
        closeSheet();
        if (act === 'rename') {
          const n = prompt('新书名:', b.name);
          if (n && n.trim()) { DB.put('book', { id: bid, name: n.trim(), updateTime: Date.now() }); renderShelf(); }
        } else if (act === 'move') {
          const groups = DB.groups();
          if (!groups.length) { toast('还没有分组,先去建一个'); return; }
          const names = groups.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
          const idx = prompt(`移到哪个分组?输入序号:\n${names}\n0. 不分组`);
          if (idx === null) return;
          const n = parseInt(idx, 10);
          if (n === 0) DB.put('book', { id: bid, groupId: '' });
          else if (groups[n - 1]) DB.put('book', { id: bid, groupId: groups[n - 1].id });
          renderGroupBar(); renderShelf();
        } else if (act === 'export') {
          exportBook(bid);
        } else if (act === 'del') {
          if (confirmBox(`删除《${b.name}》?会进回收站,可在设置里恢复。`)) {
            DB.trashBook(bid); renderShelf(); toast('已移入回收站');
          }
        }
      });
    });
  }

  function exportBook(bid) {
    const b = DB.get('book', bid);
    const chs = DB.bookChapters(bid).sort((x, y) => x.seq - y.seq);
    const text = `《${b.name}》\n\n` + chs.map((c, i) => `第${i + 1}章 ${c.name}\n\n${c.text || ''}`).join('\n\n\n');
    downloadText(`${b.name}.txt`, text);
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename.replace(/[\\/:*?"<>|]/g, '_');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  $('btn-new-book').addEventListener('click', () => {
    const name = prompt('新书名:', '我的新书');
    if (!name || !name.trim()) return;
    const b = DB.addBook(name.trim(), curGroupId);
    renderGroupBar(); renderShelf();
    openCatalog(b.id);
  });

  /* ================= 目录 ================= */
  function openCatalog(bid) {
    curBookId = bid;
    const b = DB.get('book', bid);
    if (!b) return;
    $('cat-book-name').textContent = b.name;
    renderCatalog();
    show('view-catalog');
  }

  function renderCatalog() {
    const b = DB.get('book', curBookId);
    if (!b) return;
    const chapters = DB.bookChapters(curBookId).sort((x, y) => x.seq - y.seq);
    $('cat-book-meta').textContent = `${fmtWords(DB.bookWords(curBookId))}字 · ${chapters.length}章`;

    const vols = DB.volumes(curBookId);
    let html = '';
    let idx = 0;

    const renderChaps = (list, volId) => {
      if (!list.length) {
        return `<div class="empty" style="padding:26px 20px;font-size:13px">这一卷还没有章节</div>`;
      }
      return list.map(c => {
        idx++;
        return `
          <div class="chap-item" data-aid="${c.id}">
            <span class="chap-idx">${idx}</span>
            <div class="chap-main">
              <div class="chap-name">${esc(c.name)}</div>
              <div class="chap-brief">${esc(c.brief || '空白章节')}</div>
            </div>
            <span class="chap-words">${c.wordsNumText || 0}字</span>
            <button class="chap-more" data-more="${c.id}">⋯</button>
          </div>`;
      }).join('');
    };

    if (vols.length) {
      vols.forEach(v => {
        const list = chapters.filter(c => c.volumeId === v.id);
        html += `<div class="vol-head">
            <span class="vline"></span><span>${esc(v.name)}</span>
            <span class="vacts">
              <button data-newin="${v.id}" title="在本卷新建章节">＋章</button>
              <button data-volact="${v.id}">⋯</button>
            </span>
          </div>` + renderChaps(list, v.id);
      });
      const loose = chapters.filter(c => !c.volumeId);
      if (loose.length) {
        html += `<div class="vol-head"><span class="vline"></span><span>未分卷</span></div>` + renderChaps(loose, '');
      }
    } else {
      html = renderChaps(chapters, '');
    }

    $('catalog-body').innerHTML = html;

    $('catalog-body').querySelectorAll('.chap-item').forEach(item => {
      const aid = item.dataset.aid;
      item.addEventListener('click', e => {
        if (e.target.dataset.more) return;
        openEditor(aid);
      });
    });
    $('catalog-body').querySelectorAll('[data-more]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); chapterMenu(btn.dataset.more); });
    });
    $('catalog-body').querySelectorAll('[data-newin]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); newChapter(btn.dataset.newin); });
    });
    $('catalog-body').querySelectorAll('[data-volact]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); volumeMenu(btn.dataset.volact); });
    });
  }

  function volumeMenu(vid) {
    const v = DB.get('volume', vid);
    if (!v) return;
    openSheet(v.name, `
      <div class="sheet-item" data-act="rename"><span class="si-icon">✏️</span>重命名卷</div>
      <div class="sheet-item danger" data-act="del"><span class="si-icon">🗑</span>删除卷(章节移到未分卷)</div>
    `);
    $('sheet-body').querySelectorAll('.sheet-item').forEach(it => {
      it.addEventListener('click', () => {
        const act = it.dataset.act; closeSheet();
        if (act === 'rename') {
          const n = prompt('新卷名:', v.name);
          if (n && n.trim()) { DB.put('volume', { id: vid, name: n.trim() }); renderCatalog(); }
        } else if (act === 'del') {
          if (confirmBox(`删除卷「${v.name}」?卷内章节会移到未分卷。`)) {
            DB.articles(curBookId).filter(c => c.volumeId === vid).forEach(c => DB.put('article', { id: c.id, volumeId: '' }));
            DB.del('volume', vid);
            renderCatalog();
          }
        }
      });
    });
  }

  function newChapter(volumeId) {
    const name = prompt('章节名:', `第${DB.bookChapters(curBookId).length + 1}章`);
    if (name === null) return;
    const a = DB.addArticle(curBookId, volumeId || '', (name || '').trim() || '新章节');
    renderCatalog();
    openEditor(a.id);
  }

  $('btn-new-chapter').addEventListener('click', () => {
    const vols = DB.volumes(curBookId);
    if (!vols.length) { newChapter(''); return; }
    // 有卷:选卷
    openSheet('在哪一卷新建?', vols.map(v => `<div class="sheet-item" data-vid="${v.id}"><span class="si-icon">📄</span>${esc(v.name)}</div>`).join('')
      + `<div class="sheet-item" data-vid=""><span class="si-icon">📄</span>未分卷</div>`
      + `<div class="sheet-item" data-vid="__new__"><span class="si-icon">＋</span>新建一卷</div>`);
    $('sheet-body').querySelectorAll('.sheet-item').forEach(it => {
      it.addEventListener('click', () => {
        const vid = it.dataset.vid; closeSheet();
        if (vid === '__new__') {
          const n = prompt('新卷名:', `第${vols.length + 1}卷`);
          if (!n || !n.trim()) return;
          const v = DB.addVolume(curBookId, n.trim());
          newChapter(v.id);
        } else newChapter(vid);
      });
    });
  });

  function chapterMenu(aid) {
    const a = DB.get('article', aid);
    if (!a) return;
    openSheet(a.name, `
      <div class="sheet-item" data-act="rename"><span class="si-icon">✏️</span>重命名</div>
      <div class="sheet-item" data-act="move"><span class="si-icon">📁</span>移到其他卷</div>
      <div class="sheet-item" data-act="export"><span class="si-icon">📤</span>导出本章 TXT</div>
      <div class="sheet-item danger" data-act="del"><span class="si-icon">🗑</span>删除(进回收站)</div>
    `);
    $('sheet-body').querySelectorAll('.sheet-item').forEach(it => {
      it.addEventListener('click', () => {
        const act = it.dataset.act; closeSheet();
        if (act === 'rename') {
          const n = prompt('新章节名:', a.name);
          if (n && n.trim()) { DB.put('article', { id: aid, name: n.trim() }); renderCatalog(); }
        } else if (act === 'move') {
          const vols = DB.volumes(curBookId);
          if (!vols.length) { toast('这本书还没有卷'); return; }
          openSheet('移到哪一卷?', vols.map(v => `<div class="sheet-item" data-vid="${v.id}">${esc(v.name)}</div>`).join('')
            + `<div class="sheet-item" data-vid="">未分卷</div>`);
          $('sheet-body').querySelectorAll('.sheet-item').forEach(x => {
            x.addEventListener('click', () => {
              DB.put('article', { id: aid, volumeId: x.dataset.vid }); closeSheet(); renderCatalog();
            });
          });
        } else if (act === 'export') {
          downloadText(`${a.name}.txt`, a.name + '\n\n' + (a.text || ''));
        } else if (act === 'del') {
          if (confirmBox(`删除「${a.name}」?会进回收站。`)) { DB.trashArticle(aid); renderCatalog(); toast('已移入回收站'); }
        }
      });
    });
  }

  $('btn-cat-back').addEventListener('click', () => { renderShelf(); show('view-shelf'); });
  $('btn-cat-more').addEventListener('click', () => {
    openSheet('书籍操作', `
      <div class="sheet-item" data-act="newvol"><span class="si-icon">📚</span>新建一卷</div>
      <div class="sheet-item" data-act="export"><span class="si-icon">📤</span>导出全书 TXT</div>
      <div class="sheet-item" data-act="rename"><span class="si-icon">✏️</span>重命名书籍</div>
    `);
    $('sheet-body').querySelectorAll('.sheet-item').forEach(it => {
      it.addEventListener('click', () => {
        const act = it.dataset.act; closeSheet();
        if (act === 'newvol') {
          const n = prompt('新卷名:', `第${DB.volumes(curBookId).length + 1}卷`);
          if (n && n.trim()) { DB.addVolume(curBookId, n.trim()); renderCatalog(); }
        } else if (act === 'export') exportBook(curBookId);
        else if (act === 'rename') {
          const b = DB.get('book', curBookId);
          const n = prompt('新书名:', b.name);
          if (n && n.trim()) { DB.put('book', { id: curBookId, name: n.trim() }); $('cat-book-name').textContent = n.trim(); renderCatalog(); }
        }
      });
    });
  });

  /* ================= 编辑器 ================= */
  function applyEditorStyle() {
    const s = DB.settings();
    const ta = $('ed-text');
    ta.style.fontSize = s.fontSize + 'px';
    ta.style.lineHeight = s.lineHeight;
    ta.style.fontFamily = s.fontFamily || 'inherit';
    document.body.className = document.body.className.replace(/bg-\w+/g, '').trim();
    if (s.bg && s.bg !== 'default') document.body.classList.add('bg-' + s.bg);
    document.documentElement.dataset.theme = s.theme;
  }

  function openEditor(aid) {
    const a = DB.get('article', aid);
    if (!a) { toast('章节不存在'); return; }
    curArticle = a;
    $('ed-title').value = a.name || '';
    $('ed-text').value = a.text || '';
    updateEdMeta('已保存');
    applyEditorStyle();
    resetSpeed();
    show('view-editor');
    editStartAt = Date.now();
    setTimeout(() => { $('ed-text').focus(); }, 120);
    if (document.body.classList.contains('reading')) document.body.classList.remove('reading');
  }

  /* 码字速度:最近 60 秒净增字数 */
  let speedBuf = [];
  let lastWordCount = 0;

  function resetSpeed() {
    speedBuf = [];
    lastWordCount = DB.countWords($('ed-text').value);
  }

  function trackSpeed() {
    const now = Date.now();
    const w = DB.countWords($('ed-text').value);
    const delta = w - lastWordCount;
    lastWordCount = w;
    if (delta > 0) speedBuf.push({ t: now, d: delta });
    speedBuf = speedBuf.filter(x => now - x.t < 60000);
  }

  function currentSpeed() {
    const now = Date.now();
    speedBuf = speedBuf.filter(x => now - x.t < 60000);
    return speedBuf.reduce((n, x) => n + x.d, 0);
  }

  function updateEdMeta(status) {
    $('ed-words').textContent = `${DB.countWords($('ed-text').value)} 字`;
    const sp = currentSpeed();
    $('ed-speed').textContent = sp > 0 ? `${sp} 字/分` : '';
    const st = $('ed-status');
    st.textContent = status;
    st.classList.toggle('saved', status === '已保存');
  }

  function scheduleSave() {
    dirty = true;
    updateEdMeta('编辑中…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 1500);
  }

  function doSave() {
    if (!curArticle) return;
    const text = $('ed-text').value;
    const title = $('ed-title').value.trim();
    if (text === curArticle.text && title === (curArticle.name || '')) { dirty = false; updateEdMeta('已保存'); return; }

    const before = curArticle.text;
    curArticle = DB.saveArticle(curArticle.id, text);
    if (title && title !== curArticle.name) {
      DB.put('article', { id: curArticle.id, name: title });
      curArticle.name = title;
    }
    DB.pushHistory(Object.assign({}, curArticle, { text: before, wordsNumText: DB.countWords(before) }));

    // 记写作时长
    const sec = Math.round((Date.now() - editStartAt) / 1000);
    if (sec > 5) { DB.addStat(0, sec); editStartAt = Date.now(); }

    dirty = false;
    updateEdMeta('已保存');
  }

  $('ed-text').addEventListener('input', () => { trackSpeed(); scheduleSave(); });
  $('ed-title').addEventListener('input', scheduleSave);
  $('ed-text').addEventListener('blur', () => { if (dirty) doSave(); });

  $('btn-ed-back').addEventListener('click', () => {
    if (dirty) doSave();
    if (window.Voice.active) window.Voice.stopSystem();
    curArticle = null;
    renderCatalog();
    show('view-catalog');
  });

  /* 语音 */
  $('btn-ed-voice').addEventListener('click', async () => {
    const mode = DB.settings().voiceMode || 'ime';

    if (mode === 'system') {
      if (window.Voice.active) { window.Voice.stopSystem(); toast('已停止听写'); return; }
      try {
        toast('正在启动系统语音识别…');
        await window.Voice.startSystem(
          (text) => {
            const ta = $('ed-text');
            const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
            ta.value = v.slice(0, s) + text + v.slice(e);
            const pos = s + text.length;
            ta.setSelectionRange(pos, pos);
            scheduleSave();
          },
          (info) => {
            if (info && info.error) {
              toast('系统识别不可用,已切换到输入法语音', 2600);
              DB.setSetting('voiceMode', 'ime');
              window.Voice.startIme(() => $('voice-hint').classList.remove('hidden'));
            }
          }
        );
      } catch (err) {
        toast('系统识别不可用,已切换到输入法语音', 2600);
        DB.setSetting('voiceMode', 'ime');
        window.Voice.startIme(() => $('voice-hint').classList.remove('hidden'));
      }
      return;
    }

    // 输入法语音(默认):聚焦 + 强制弹键盘,再按诊断结果给准确提示
    const ok = await window.Voice.startIme();
    if (!ok) { toast('请先打开一篇文章'); return; }

    const hintText = $('voice-hint-text');
    const diag = await window.Voice.diagnose();
    if (diag) {
      if (diag.inputMethodHasOwnVoice) {
        hintText.textContent = '🎤 你的输入法自带语音，点键盘上的麦克风键说话，说完文字自动进正文';
      } else if (!diag.systemRecognition) {
        hintText.textContent = '⚠️ 这台手机的系统语音服务已停用。请装「搜狗输入法」或「讯飞输入法」，用它们键盘上的麦克风';
      } else {
        hintText.textContent = '🎤 点键盘上的麦克风键说话，说完文字自动进正文';
      }
    }
    $('voice-hint').classList.remove('hidden');
    clearTimeout(window._vhTimer);
    window._vhTimer = setTimeout(() => $('voice-hint').classList.add('hidden'), 15000);
  });
  $('voice-hint-close').addEventListener('click', () => $('voice-hint').classList.add('hidden'));

  /* 历史版本 */
  $('ed-tool-history').addEventListener('click', () => {
    if (!curArticle) return;
    const hist = DB.history(curArticle.id);
    openSheet('历史版本', hist.length ? hist.map(h => `
      <div class="sheet-item" data-hid="${h.id}">
        <span class="si-icon">🕘</span>
        <div style="flex:1">
          <div>${fmtDate(h.createTime)}</div>
          <div style="font-size:12px;color:var(--sub);margin-top:2px">${h.wordsNumText || 0} 字 · ${esc((h.text || '').slice(0, 24))}…</div>
        </div>
      </div>`).join('') : '<div class="empty" style="padding:30px 0">暂无历史版本<br>每次保存间隔 3 分钟以上会留快照</div>');

    $('sheet-body').querySelectorAll('[data-hid]').forEach(it => {
      it.addEventListener('click', () => {
        const h = hist.find(x => x.id === it.dataset.hid);
        if (!h) return;
        if (confirmBox('用这个版本覆盖当前正文?当前内容会先存一份历史。')) {
          const cur = $('ed-text').value;
          DB.pushHistory(Object.assign({}, curArticle, { text: cur, wordsNumText: DB.countWords(cur), createTime: 0 }));
          $('ed-text').value = h.text || '';
          closeSheet();
          doSave();
          updateEdMeta('已恢复');
        }
      });
    });
  });

  /* 排版 */
  $('ed-tool-type').addEventListener('click', () => {
    const s = DB.settings();
    openSheet('排版设置', `
      <div class="set-row">
        <span class="sr-label">字号</span>
        <input type="range" id="tp-size" min="13" max="26" step="1" value="${s.fontSize}">
        <span class="set-val" id="tp-size-v">${s.fontSize}</span>
      </div>
      <div class="set-row">
        <span class="sr-label">行距</span>
        <input type="range" id="tp-lh" min="1.4" max="2.6" step="0.1" value="${s.lineHeight}">
        <span class="set-val" id="tp-lh-v">${s.lineHeight}</span>
      </div>
      <div class="set-row">
        <span class="sr-label">字体</span>
        <select id="tp-font">
          <option value="">系统默认</option>
          <option value="serif">宋体/衬线</option>
          <option value="sans-serif">黑体/无衬线</option>
          <option value="monospace">等宽</option>
        </select>
      </div>
      <div class="set-row" style="flex-wrap:wrap;gap:8px">
        <span class="sr-label" style="flex-basis:100%">背景</span>
        ${['default:默认', 'paper:纸白', 'sepia:羊皮纸', 'green:护眼绿', 'dark:夜间'].map(x => {
          const [k, n] = x.split(':');
          return `<button class="chip ${s.bg === k ? 'active' : ''}" data-bg="${k}">${n}</button>`;
        }).join('')}
      </div>
    `);
    $('tp-font').value = s.fontFamily || '';
    const apply = () => {
      const fs = +$('tp-size').value, lh = +$('tp-lh').value, ff = $('tp-font').value;
      $('tp-size-v').textContent = fs; $('tp-lh-v').textContent = lh;
      DB.setSetting('fontSize', fs); DB.setSetting('lineHeight', lh); DB.setSetting('fontFamily', ff);
      applyEditorStyle();
    };
    $('tp-size').addEventListener('input', apply);
    $('tp-lh').addEventListener('input', apply);
    $('tp-font').addEventListener('change', apply);
    $('sheet-body').querySelectorAll('[data-bg]').forEach(b => {
      b.addEventListener('click', () => {
        DB.setSetting('bg', b.dataset.bg);
        $('sheet-body').querySelectorAll('[data-bg]').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        applyEditorStyle();
      });
    });
  });

  /* 阅读模式 */
  $('ed-tool-reading').addEventListener('click', () => {
    document.body.classList.toggle('reading');
    if (document.body.classList.contains('reading')) {
      toast('阅读模式:再点一次退出(工具条已隐藏,双击屏幕顶部退出)', 2400);
    }
  });
  // 阅读模式下双击顶部退出
  $('ed-text').addEventListener('dblclick', () => {
    if (document.body.classList.contains('reading')) document.body.classList.remove('reading');
  });

  /* 编辑器更多 */
  $('btn-ed-more').addEventListener('click', () => {
    openSheet('章节操作', `
      <div class="sheet-item" data-act="rename"><span class="si-icon">✏️</span>重命名</div>
      <div class="sheet-item" data-act="share"><span class="si-icon">🖼</span>生成长图分享</div>
      <div class="sheet-item" data-act="export"><span class="si-icon">📤</span>导出本章 TXT</div>
      <div class="sheet-item danger" data-act="trash"><span class="si-icon">🗑</span>删除(进回收站)</div>
    `);
    $('sheet-body').querySelectorAll('.sheet-item').forEach(it => {
      it.addEventListener('click', () => {
        const act = it.dataset.act; closeSheet();
        if (act === 'share') {
          window.Tools.makeShareImage();
        } else if (act === 'rename') {
          const n = prompt('新章节名:', $('ed-title').value);
          if (n && n.trim()) { $('ed-title').value = n.trim(); doSave(); }
        } else if (act === 'export') {
          downloadText(`${$('ed-title').value}.txt`, $('ed-title').value + '\n\n' + $('ed-text').value);
        } else if (act === 'trash') {
          if (confirmBox('删除本章?')) {
            DB.trashArticle(curArticle.id); curArticle = null;
            renderCatalog(); show('view-catalog'); toast('已移入回收站');
          }
        }
      });
    });
  });

  /* ================= 统计 ================= */
  function renderStats() {
    const stats = DB.stats();
    const today = stats.find(s => s.date === DB.todayKey());
    const totalWords = DB.totalWords();
    const streak = DB.streak();
    const todayMin = today ? Math.round((today.writeDuration || 0) / 60) : 0;

    const goal = DB.settings().dailyGoal || 2000;
    const todayWords = today ? (today.wordsTxtInput || 0) : 0;
    const pct = Math.min(100, Math.round(todayWords / goal * 100));

    $('stat-cards').innerHTML = `
      <div class="goal-card">
        <div class="goal-head">
          <span>今日目标</span>
          <b>${todayWords} <i>/ ${goal}</i></b>
        </div>
        <div class="goal-bar"><i style="width:${pct}%"></i></div>
        <div class="goal-foot">${pct >= 100 ? '目标达成' : `还差 ${goal - todayWords} 字`}</div>
      </div>
      <div class="stat-card"><div class="sv">${todayWords}</div><div class="sl">今日字数</div></div>
      <div class="stat-card"><div class="sv">${fmtWords(totalWords)}</div><div class="sl">总字数</div></div>
      <div class="stat-card"><div class="sv">${streak}</div><div class="sl">连续写作天数</div></div>
      <div class="stat-card"><div class="sv">${todayMin}</div><div class="sl">今日写作(分钟)</div></div>`;

    // 近 14 天柱状图
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const p = n => String(n).padStart(2, '0');
      const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      const s = stats.find(x => x.date === key);
      days.push({ key, label: key.slice(5), v: s ? (s.wordsTxtInput || 0) : 0 });
    }
    drawChart(days);

    $('stat-list').innerHTML = stats.length ? stats.slice(0, 20).map(s => `
      <div class="stat-row">
        <span class="sr-date">${s.date}</span>
        <span class="sr-val">${s.wordsTxtInput || 0} 字 · ${Math.round((s.writeDuration || 0) / 60)} 分</span>
      </div>`).join('') : '<div class="empty" style="padding:24px 0">还没有写作记录</div>';
  }

  function drawChart(days) {
    const c = $('stat-chart');
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 320, h = 160;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const max = Math.max(100, ...days.map(d => d.v));
    const padB = 22, padT = 10;
    const barW = (w - 16) / days.length;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f6ef7';
    const sub = getComputedStyle(document.documentElement).getPropertyValue('--sub').trim() || '#8a8a9c';

    days.forEach((d, i) => {
      const bh = Math.max(2, (d.v / max) * (h - padB - padT));
      const x = 8 + i * barW + barW * 0.2;
      const bw = barW * 0.6;
      const y = h - padB - bh;
      ctx.fillStyle = d.v > 0 ? accent : (getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#ebebf0');
      ctx.beginPath();
      const r = Math.min(4, bw / 2);
      ctx.roundRect ? ctx.roundRect(x, y, bw, bh, r) : ctx.rect(x, y, bw, bh);
      ctx.fill();
      if (i % 3 === 0) {
        ctx.fillStyle = sub; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(d.label, x + bw / 2, h - 6);
      }
    });
  }

  $('btn-stats').addEventListener('click', () => { renderStats(); show('view-stats'); });
  $('btn-tools').addEventListener('click', () => window.Tools.openNameGen());
  $('btn-annual').addEventListener('click', () => window.Tools.openAnnualReport());
  $('ed-tool-find').addEventListener('click', () => window.Tools.openFindReplace());
  $('ed-tool-quick').addEventListener('click', () => window.Tools.openQuickInput());
  $('btn-stats-back').addEventListener('click', () => { renderShelf(); show('view-shelf'); });

  /* ================= 设置 ================= */
  /* ---------------- 应用锁 ---------------- */
  function setLockFlow() {
    const cur = DB.settings().lockCode;
    const v = prompt(cur ? '输入新密码（留空则关闭应用锁）' : '设置 4-8 位数字密码（留空取消）', '');
    if (v === null) return;
    const t = v.trim();
    if (!t) { DB.setSetting('lockCode', ''); toast('已关闭应用锁'); renderSettings(); return; }
    if (!/^\d{4,8}$/.test(t)) { toast('请使用 4-8 位数字'); return; }
    DB.setSetting('lockCode', t);
    toast('应用锁已设置');
    renderSettings();
  }

  function checkLock() {
    const code = DB.settings().lockCode;
    if (!code) return;
    const el = document.createElement('div');
    el.className = 'lock-screen';
    el.innerHTML = `
      <div class="lock-inner">
        <div class="lock-brand">白泽写作</div>
        <div class="lock-sub">输入密码解锁</div>
        <input id="lock-input" type="password" inputmode="numeric" maxlength="8" placeholder="••••" autocomplete="off">
        <button id="lock-ok" class="btn-primary">解锁</button>
      </div>`;
    document.body.appendChild(el);
    const inp = el.querySelector('#lock-input');
    const tryUnlock = () => {
      if (inp.value === code) { el.remove(); return; }
      inp.value = '';
      inp.classList.add('shake');
      setTimeout(() => inp.classList.remove('shake'), 420);
    };
    el.querySelector('#lock-ok').addEventListener('click', tryUnlock);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 260);
  }

  function renderSettings() {
    const s = DB.settings();
    const body = $('settings-body');
    body.innerHTML = `
      <div class="set-group">
        <div class="set-group-title">写作</div>
        <div class="set-row">
          <span class="sr-label">每日字数目标<span class="sr-sub">统计页显示进度</span></span>
          <input type="text" inputmode="numeric" id="st-goal" value="${s.dailyGoal || 2000}" style="flex:0 0 88px;text-align:right">
        </div>
        <div class="set-row">
          <span class="sr-label">书架排序</span>
          <select id="st-sort">
            <option value="update" ${(s.bookSort || 'update') === 'update' ? 'selected' : ''}>最近更新</option>
            <option value="name" ${s.bookSort === 'name' ? 'selected' : ''}>书名</option>
            <option value="words" ${s.bookSort === 'words' ? 'selected' : ''}>字数</option>
          </select>
        </div>
        <div class="set-row">
          <span class="sr-label">应用锁<span class="sr-sub">${s.lockCode ? '已开启，启动需密码' : '未开启'}</span></span>
          <button class="chip ${s.lockCode ? 'active' : ''}" id="st-lock">${s.lockCode ? '修改' : '设置'}</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-group-title">外观</div>
        <div class="set-row">
          <span class="sr-label">夜间模式</span>
          <button class="chip ${s.theme === 'dark' ? 'active' : ''}" id="st-theme">${s.theme === 'dark' ? '已开启' : '已关闭'}</button>
        </div>
        <div class="set-row">
          <span class="sr-label">字号<span class="sr-sub">正文大小</span></span>
          <input type="range" id="st-size" min="13" max="26" step="1" value="${s.fontSize}">
          <span class="set-val">${s.fontSize}</span>
        </div>
        <div class="set-row">
          <span class="sr-label">行距</span>
          <input type="range" id="st-lh" min="1.4" max="2.6" step="0.1" value="${s.lineHeight}">
          <span class="set-val">${s.lineHeight}</span>
        </div>
        <div class="set-row">
          <span class="sr-label">写作背景</span>
          <select id="st-bg">
            ${[['default', '默认'], ['paper', '纸白'], ['sepia', '羊皮纸'], ['green', '护眼绿'], ['dark', '夜间']]
              .map(([k, n]) => `<option value="${k}" ${s.bg === k ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="set-group">
        <div class="set-group-title">语音输入</div>
        <div class="set-row">
          <span class="sr-label">语音方式<span class="sr-sub">输入法:弹键盘用输入法麦克风;系统:App 内直接听写</span></span>
          <select id="st-voice">
            <option value="ime" ${s.voiceMode === 'ime' ? 'selected' : ''}>输入法语音(推荐)</option>
            <option value="system" ${s.voiceMode === 'system' ? 'selected' : ''}>系统识别</option>
          </select>
        </div>
        <div class="set-row">
          <span class="sr-label">环境检测<span class="sr-sub">查这台手机到底能不能语音</span></span>
          <button id="st-voice-diag" class="tool-btn" style="padding:6px 14px">检测</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-group-title">版本更新</div>
        <div class="set-row">
          <span class="sr-label">当前版本</span>
          <span class="set-val">v${window.Update.versionName}</span>
        </div>
        <div class="set-row">
          <span class="sr-label">自动检查更新<span class="sr-sub">启动时每 12 小时检查一次</span></span>
          <button class="chip ${s.autoUpdate ? 'active' : ''}" id="st-auto">${s.autoUpdate ? '已开启' : '已关闭'}</button>
        </div>
        <div class="set-row">
          <span class="sr-label">更新清单地址<span class="sr-sub">填写 JSON 地址后启用检查</span></span>
          <input type="text" id="st-upurl" placeholder="https://…/version.json" value="${esc(s.updateUrl || '')}">
        </div>
        <div class="set-row">
          <button class="btn-primary" id="st-check">检查更新</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-group-title">数据</div>
        <div class="set-row" id="st-recycle"><span class="sr-label">回收站</span><span class="set-val">${DB.recycle().length} 项 ›</span></div>
        <div class="set-row" id="st-export"><span class="sr-label">导出全部数据(JSON 备份)</span><span class="set-val">›</span></div>
      </div>

      <div class="set-group">
        <div class="set-group-title">关于</div>
        <div class="set-row"><span class="sr-label">白泽写作</span><span class="set-val">v${window.Update.versionName}</span></div>
      </div>
    `;

    $('st-goal').addEventListener('change', e => {
      const v = parseInt(e.target.value, 10);
      DB.setSetting('dailyGoal', (!v || v < 100) ? 2000 : v);
      e.target.value = DB.settings().dailyGoal;
      toast('目标已更新');
    });
    $('st-sort').addEventListener('change', e => {
      DB.setSetting('bookSort', e.target.value);
      renderShelf();
      toast('排序已更新');
    });
    $('st-lock').addEventListener('click', setLockFlow);

    $('st-theme').addEventListener('click', () => {
      const cur = DB.settings().theme;
      DB.setSetting('theme', cur === 'dark' ? 'light' : 'dark');
      applyEditorStyle(); renderSettings();
    });
    $('st-size').addEventListener('change', e => { DB.setSetting('fontSize', +e.target.value); applyEditorStyle(); renderSettings(); });
    $('st-lh').addEventListener('change', e => { DB.setSetting('lineHeight', +e.target.value); applyEditorStyle(); renderSettings(); });
    $('st-bg').addEventListener('change', e => { DB.setSetting('bg', e.target.value); applyEditorStyle(); });
    $('st-voice').addEventListener('change', e => { DB.setSetting('voiceMode', e.target.value); toast('已切换语音方式'); });
    $('st-voice-diag').addEventListener('click', async () => {
      const d = await window.Voice.diagnose();
      if (!d) { toast('浏览器里没法检测，装 APK 后可用'); return; }
      const lines = [
        '系统语音服务：' + (d.systemRecognition ? '可用' : '不可用（已停用）'),
        '当前输入法：' + (d.inputMethod || '未知'),
        '输入法自带语音：' + (d.inputMethodHasOwnVoice ? '是' : '否'),
      ];
      let advice;
      if (d.inputMethodHasOwnVoice) advice = '✅ 你的输入法自带语音，直接用输入法麦克风即可';
      else if (!d.systemRecognition) advice = '⚠️ 系统语音被停用，且输入法没有自己的语音。装「搜狗输入法」或「讯飞输入法」就能用';
      else advice = '✅ 系统语音可用，两种方式都能试';
      openSheet('语音环境检测', `
        <div style="padding:16px 18px;line-height:2;font-size:14px">
          ${lines.map(l => `<div>${l}</div>`).join('')}
          <div style="margin-top:12px;padding:12px;border-radius:10px;background:var(--bg-soft,#f4f4f5)">${advice}</div>
        </div>
      `);
    });
    $('st-auto').addEventListener('click', () => {
      DB.setSetting('autoUpdate', !DB.settings().autoUpdate); renderSettings();
    });
    $('st-upurl').addEventListener('change', e => {
      DB.setSetting('updateUrl', e.target.value.trim());
      toast('清单地址已保存');
    });
    $('st-check').addEventListener('click', async () => {
      try {
        toast('正在检查…');
        const r = await window.Update.check();
        if (r.noUrl) { toast('请先填写更新清单地址', 2400); return; }
        if (r.hasUpdate) {
          const m = r.manifest;
          openSheet('发现新版本 v' + m.versionName, `
            <div style="font-size:13px;color:var(--sub);line-height:1.8;margin-bottom:14px">${esc(m.notes || '优化体验与修复问题')}</div>
            <button class="btn-primary" id="btn-do-update">立即更新</button>
          `);
          $('btn-do-update').addEventListener('click', () => { closeSheet(); window.Update.install(m); });
        } else {
          toast('已是最新版本 v' + window.Update.versionName);
        }
      } catch (e) { toast('检查失败,请确认清单地址可访问', 2600); }
    });

    $('st-recycle').addEventListener('click', openRecycle);
    $('st-export').addEventListener('click', () => {
      const data = {
        version: 2, exportedAt: new Date().toISOString(),
        group: DB.all('group'), book: DB.all('book'), volume: DB.all('volume'),
        article: DB.all('article'), history: DB.all('history'), stat: DB.all('stat'),
      };
      downloadText(`白泽写作备份-${DB.todayKey()}.json`, JSON.stringify(data, null, 2));
      toast('备份已导出');
    });
  }

  function openRecycle() {
    const items = DB.recycle();
    openSheet('回收站', items.length ? items.map(r => `
      <div class="sheet-item" data-rid="${r.id}">
        <span class="si-icon">${r.type === 'book' ? '📕' : '📄'}</span>
        <div style="flex:1">
          <div>${esc(r.name)}</div>
          <div style="font-size:12px;color:var(--sub);margin-top:2px">${r.type === 'book' ? '整本' : '章节'} · ${r.wordsNumText || 0} 字 · ${fmtDate(r.createTime)}</div>
        </div>
        <span style="color:var(--accent);font-size:13px">恢复</span>
      </div>`).join('') : '<div class="empty" style="padding:30px 0">回收站是空的</div>');

    $('sheet-body').querySelectorAll('[data-rid]').forEach(it => {
      it.addEventListener('click', () => {
        DB.restore(it.dataset.rid);
        closeSheet();
        toast('已恢复');
        renderShelf(); renderSettings();
      });
    });
  }

  $('btn-settings').addEventListener('click', () => { renderSettings(); show('view-settings'); });
  $('btn-set-back').addEventListener('click', () => { renderShelf(); show('view-shelf'); });

  /* ================= 启动 ================= */
  function boot() {
    const s = DB.settings();
    document.documentElement.dataset.theme = s.theme;
    applyEditorStyle();

    // 首次使用:建一本示例书
    if (!DB.all('book').length) {
      const b = DB.addBook('我的第一本书');
      const a = DB.addArticle(b.id, '', '第一章');
      DB.put('article', { id: a.id, text: '' });
    }

    renderGroupBar();
    renderShelf();

    // 静默检查更新
    window.Update.silentCheck((m) => {
      openSheet('发现新版本 v' + m.versionName, `
        <div style="font-size:13px;color:var(--sub);line-height:1.8;margin-bottom:14px">${esc(m.notes || '')}</div>
        <button class="btn-primary" id="btn-up-now">立即更新</button>
        <button class="btn-ghost" id="btn-up-later">以后再说</button>
      `);
      $('btn-up-now').addEventListener('click', () => { closeSheet(); window.Update.install(m); });
      $('btn-up-later').addEventListener('click', closeSheet);
    });
  }

  // 返回键:优先关闭抽屉
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSheet(); }
  });

  boot();
  checkLock();
})();

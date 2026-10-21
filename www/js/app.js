/* ===== 白泽写作 - 主逻辑 ===== */
(function () {
  const $ = (id) => document.getElementById(id);
  const S = window.Storage;

  let currentId = null;       // 当前编辑的文章
  let currentArticle = null;
  let saveTimer = null;
  let dirty = false;

  /* ---------- 工具 ---------- */
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), ms || 1800);
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function countWords(s) {
    // 中文字符按 1 字算,英文单词按 1 词算
    const cn = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const en = (s.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[a-zA-Z0-9]+/g) || []).length;
    return cn + en;
  }

  /* ---------- 主题 ---------- */
  function applyTheme() {
    const theme = S.getSettings().theme || 'light';
    document.documentElement.dataset.theme = theme;
    $('btn-theme').textContent = theme === 'dark' ? '☀️' : '🌙';
  }
  $('btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    S.setSetting('theme', cur === 'dark' ? 'light' : 'dark');
    applyTheme();
  });

  /* ---------- 页面切换 ---------- */
  function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    $(name).classList.add('active');
  }

  /* ---------- 文章列表 ---------- */
  function renderList() {
    const kw = $('search-input').value.trim().toLowerCase();
    const gid = $('group-filter').value;
    let list = S.getArticles();

    if (gid) list = list.filter(a => a.groupId === gid);
    if (kw) {
      list = list.filter(a =>
        (a.title || '').toLowerCase().includes(kw) ||
        (a.content || '').toLowerCase().includes(kw));
    }
    // 按更新时间倒序
    list.sort((a, b) => b.updateTime - a.updateTime);

    const box = $('article-list');
    if (!list.length) {
      box.innerHTML = `<div class="empty-hint">还没有文章<br>点右下角 ＋ 开始写作</div>`;
      return;
    }
    const groups = {};
    S.getGroups().forEach(g => groups[g.id] = g.name);
    box.innerHTML = list.map(a => `
      <div class="article-card" data-id="${a.id}">
        <div class="a-title">${esc(a.title || '无标题')}</div>
        <div class="a-brief">${esc((a.content || '').slice(0, 80) || '空文档')}</div>
        <div class="a-meta">
          ${a.groupId && groups[a.groupId] ? `<span class="a-tag">${esc(groups[a.groupId])}</span>` : ''}
          <span>${a.wordCount || 0} 字</span>
          <span>${fmtTime(a.updateTime)}</span>
        </div>
        <button class="a-del" data-del="${a.id}" title="删除">🗑</button>
      </div>`).join('');

    box.querySelectorAll('.article-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.dataset.del) return;
        openEditor(card.dataset.id);
      });
    });
    box.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.del;
        if (confirm('删除这篇文章及其历史?不可恢复。')) {
          S.deleteArticle(id);
          renderList();
          toast('已删除');
        }
      });
    });
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderGroups() {
    const groups = S.getGroups();
    $('group-filter').innerHTML = '<option value="">全部分组</option>' +
      groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  }

  $('search-input').addEventListener('input', renderList);
  $('group-filter').addEventListener('change', renderList);

  /* 新建:可选分组 —— 无分组直接建,长按/后续在编辑页进 */
  $('btn-new').addEventListener('click', () => {
    const groups = S.getGroups();
    let gid = null;
    if (groups.length) {
      const names = groups.map(g => g.name).join(' / ');
      const name = prompt(`输入分组名(可不填)。已有分组:${names}`);
      if (name === null) return;
      if (name.trim()) {
        let g = groups.find(x => x.name === name.trim()) || S.addGroup(name.trim());
        gid = g.id;
      }
    }
    const now = Date.now();
    const art = {
      id: S.uid(), title: '', content: '', groupId: gid,
      createTime: now, updateTime: now, wordCount: 0,
    };
    S.upsertArticle(art);
    openEditor(art.id);
  });

  /* ---------- 编辑器 ---------- */
  function openEditor(id) {
    currentArticle = S.getArticle(id);
    if (!currentArticle) { toast('文章不存在'); return; }
    currentId = id;
    $('title-input').value = currentArticle.title || '';
    $('content-input').value = currentArticle.content || '';
    updateMeta('已保存');
    showPage('page-editor');
    setTimeout(() => $('content-input').focus(), 100);
  }

  function updateMeta(status) {
    $('word-count').textContent = `${countWords($('content-input').value)} 字`;
    const st = $('save-status');
    st.textContent = status;
    st.classList.toggle('saved', status === '已保存');
  }

  function scheduleSave() {
    dirty = true;
    updateMeta('编辑中…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 1500);
  }

  function doSave() {
    if (!currentArticle) return;
    const title = $('title-input').value;
    const content = $('content-input').value;
    // 内容无变化不写
    if (currentArticle.title === title && currentArticle.content === content) {
      dirty = false; updateMeta('已保存'); return;
    }
    currentArticle.title = title;
    currentArticle.content = content;
    currentArticle.wordCount = countWords(content);
    currentArticle.updateTime = Date.now();
    S.upsertArticle(currentArticle);
    S.pushHistory(currentArticle); // 5 分钟节流的快照
    dirty = false;
    updateMeta('已保存');
  }

  $('content-input').addEventListener('input', scheduleSave);
  $('title-input').addEventListener('input', scheduleSave);
  $('content-input').addEventListener('blur', () => { if (dirty) doSave(); });

  // 返回:先保存
  $('btn-back').addEventListener('click', () => {
    if (dirty) doSave();
    currentId = null; currentArticle = null;
    renderList();
    showPage('page-list');
  });

  /* ---------- 语音输入 ---------- */
  const overlay = $('voice-overlay');
  const voiceStatus = $('voice-status');

  $('btn-voice').addEventListener('click', async () => {
    if (window.Voice.listening) { window.Voice.stop(); return; }
    if (!window.Voice.isSupported) { toast('此设备不支持语音识别'); return; }
    try {
      overlay.classList.remove('hidden');
      $('voice-partial').textContent = '';
      await window.Voice.start(
        (text) => {
          // 插入到光标处
          const ta = $('content-input');
          const s = ta.selectionStart, e = ta.selectionEnd;
          const v = ta.value;
          const insert = (v && !/\s$/.test(v.slice(0, s)) && !/^\s/.test(text) ? '' : '') + text;
          ta.value = v.slice(0, s) + insert + v.slice(e);
          const pos = s + insert.length;
          ta.setSelectionRange(pos, pos);
          ta.focus();
          $('voice-partial').textContent = text;
          scheduleSave();
        },
        () => {
          overlay.classList.add('hidden');
          voiceStatus.textContent = '';
        }
      );
      $('btn-voice').classList.add('listening');
      voiceStatus.textContent = '语音输入中…';
    } catch (e) {
      overlay.classList.add('hidden');
      toast('语音启动失败:' + (e.message || e));
    }
  });
  $('btn-voice-stop').addEventListener('click', () => {
    window.Voice.stop();
    $('btn-voice').classList.remove('listening');
  });
  // 监听 onEnd 时把按钮状态复位(voice.js 的 onEnd 回调里处理 overlay,这里补按钮)
  const _origStart = window.Voice.start.bind(window.Voice);

  /* ---------- 历史版本 ---------- */
  $('btn-history').addEventListener('click', () => {
    if (!currentArticle) return;
    const hist = S.getHistory(currentArticle.id);
    const box = $('history-list');
    box.innerHTML = hist.length ? hist.map(h => `
      <div class="history-item" data-hid="${h.id}">
        <div class="h-time">${fmtTime(h.saveTime)} · ${h.wordCount} 字</div>
        <div class="h-brief">${esc((h.content || '').slice(0, 60) || '空')}</div>
      </div>`).join('')
      : '<div class="empty-hint">暂无历史版本<br>编辑超过 5 分钟会自动存快照</div>';
    box.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        const h = hist.find(x => x.id === item.dataset.hid);
        if (!h) return;
        if (confirm('用这个版本覆盖当前内容?(当前内容会先存进历史)')) {
          doSave(); // 当前内容入历史
          $('content-input').value = h.content;
          scheduleSave();
          closeHistory();
          toast('已恢复');
        }
      });
    });
    $('history-drawer').classList.remove('hidden');
  });
  function closeHistory() { $('history-drawer').classList.add('hidden'); }
  $('btn-history-close').addEventListener('click', closeHistory);
  $('history-mask').addEventListener('click', closeHistory);

  /* ---------- 导出 ---------- */
  $('btn-export').addEventListener('click', () => {
    if (!currentArticle) return;
    if (dirty) doSave();
    const title = ($('title-input').value || '无标题').replace(/[\\/:*?"<>|]/g, '_');
    const text = $('title-input').value + '\n\n' + $('content-input').value;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = title + '.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('已导出 TXT');
  });

  /* ---------- 启动 ---------- */
  applyTheme();
  renderGroups();
  renderList();
})();

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
    const eb = $('btn-exit-immersive');
    if (eb) eb.classList.add('hidden');
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

  /* 供 tools.js 复用;cropCover 一并导出,便于端到端测裁切比例 */
  window.UI = { openSheet, closeSheet, show, esc, fmtWords, toast, cropCover };

  function confirmBox(msg) { return window.confirm(msg); }

  /* 封面色:近白纸底 + 一条彩色书脊。
   *
   * 为什么不是整块彩色:浅底 + 中饱和(明度 60 左右)是最难看的一档 ——
   * 不够素雅也不够有设计感,活像便利贴。整块深色又发闷(白字压不住深色,只能一路压暗)。
   * 所以把颜色从"整块"挪到"书脊那一条":底色接近白(明度 90~93,深字对比 13.6~14.7,
   * 怎么都读得清),色相身份由 9px 的书脊色带承担 —— 真实书架就是这个样子。
   *
   * ★ 数组按色相升序 —— 防撞色靠"索引顺延"换色系,乱序的话顺延一位还是同一个色。
   */
  const COVER_COLORS = [
    'linear-gradient(158deg,#eedcd8,#ead1cc)',  // 胭脂 H10  深字12.5
    'linear-gradient(158deg,#eee5d8,#eadecc)',  // 陶土 H35  深字13.2
    'linear-gradient(158deg,#edeed8,#e9eacc)',  // 麦金 H62  深字14.0
    'linear-gradient(158deg,#dfeed8,#d6eacc)',  // 橄榄 H100 深字13.6
    'linear-gradient(158deg,#d8eede,#ccead4)',  // 苔绿 H135 深字13.5
    'linear-gradient(158deg,#d8eee8,#cceae3)',  // 青瓷 H165 深字13.6
    'linear-gradient(158deg,#d8e8ee,#cce3ea)',  // 石板 H195 深字13.1
    'linear-gradient(158deg,#d8deee,#ccd4ea)',  // 雾蓝 H225 深字12.2
    'linear-gradient(158deg,#ded8ee,#d4ccea)',  // 靛青 H255 深字11.9
    'linear-gradient(158deg,#e8d8ee,#e3ccea)',  // 灰紫 H285 深字12.2
    'linear-gradient(158deg,#eed8e8,#eacce3)',  // 藕紫 H315 深字12.3
    'linear-gradient(158deg,#eed8df,#eaccd5)',  // 紫灰 H342 深字12.2
  ];
  /* 书脊色带:与底色同色相,饱和 52 / 明度 50,9px 细条上正好压得住白底 */
  const SPINE_COLORS = [
    '#c2533d', '#c28b3d', '#bdc23d', '#69c23d', '#3dc25e', '#3dc2a1',
    '#3da1c2', '#3d5ec2', '#5e3dc2', '#a13dc2', '#c23da1', '#c23d65',
  ];
  function coverIndex(book) {
    let h = 0;
    for (const c of (book.id || '')) h = (h * 31 + c.charCodeAt(0)) % 997;
    return h % COVER_COLORS.length;
  }
  /* 色板按色相升序,所以"索引距离"就是"色相距离"的代理。
   * 只判重索引不够 —— 相邻索引也是相近色系,要一起避开。 */
  function hueGap(a, b) {
    const n = COVER_COLORS.length;
    const d = Math.abs(a - b) % n;
    return Math.min(d, n - d);
  }

  /* 长按
   * 注意:长按之后 touchend 仍会派发 click,如果不管,长按打开菜单的同时
   * 点击处理器也会跑(书架会长按后直接跳进目录,菜单白开)。
   * 所以在捕获阶段把紧跟着的那次 click 吃掉。
   */
  function bindLongPress(el, fn) {
    let timer = null, moved = false, fired = false;
    el.addEventListener('touchstart', e => {
      moved = false; fired = false;
      timer = setTimeout(() => {
        if (moved) return;
        fired = true;
        fn(e);
        if (navigator.vibrate) navigator.vibrate(12);
      }, 480);
    }, { passive: true });
    el.addEventListener('touchmove', () => { moved = true; clearTimeout(timer); }, { passive: true });
    el.addEventListener('touchend', () => clearTimeout(timer));
    el.addEventListener('touchcancel', () => { clearTimeout(timer); fired = false; });
    el.addEventListener('click', e => {
      if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; }
    }, true);
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

  /* ---------------- 封面选图 ----------------
   * 手机相册选一张,居中裁成书封比例(2 : 2.9),缩到 480 宽存 JPEG。
   * 不存原图:一张手机照片 3~5MB,几十本书就能把存储撑爆。
   */
  function cropCover(dataUrl) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const TW = 480, TH = Math.round(TW * 2.9 / 2);
        const cv = document.createElement('canvas');
        cv.width = TW; cv.height = TH;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, TW, TH);
        const tAR = TW / TH;
        const sAR = (img.width || 1) / (img.height || 1);
        let sw, sh, sx, sy;
        if (sAR > tAR) { sh = img.height; sw = sh * tAR; sx = (img.width - sw) / 2; sy = 0; }
        else { sw = img.width; sh = sw / tAR; sx = 0; sy = (img.height - sh) / 2; }
        try {
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TW, TH);
          res(cv.toDataURL('image/jpeg', 0.82));
        } catch (e) { rej(e); }
      };
      img.onerror = () => rej(new Error('这张图读不出来'));
      img.src = dataUrl;
    });
  }

  function pickCover(bid) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      setTimeout(() => inp.remove(), 100);
      if (!f) return;
      if (f.size > 20 * 1048576) { toast('图片太大了,换一张小点的'); return; }
      toast('正在处理图片…');
      const fr = new FileReader();
      fr.onload = () => {
        cropCover(fr.result).then(dataUrl => {
          DB.put('book', { id: bid, cover: dataUrl, updateTime: Date.now() });
          DB.flush();   // 别让"选完封面就切后台"把封面丢了
          renderShelf(); renderResume();
          toast('封面已换好');
        }).catch(e => toast('处理失败:' + e.message));
      };
      fr.onerror = () => toast('读不出这个文件');
      fr.readAsDataURL(f);
    });
    inp.click();
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
    /* 同一屏内不要出现同色系封面(最近 4 本做窗口)。
     * 判定用色相距离 >= 3 档(约 90°),而不是"索引不相同" ——
     * 2 档(60°)试过不够:粉紫 H315 和蓝紫 H255 隔着 2 档,肉眼还是"两本紫书"。 */
    const recent = [];
    grid.innerHTML = books.map(b => {
      const words = DB.bookWords(b.id);
      const chs = DB.bookChapters(b.id).length;
      let ci = coverIndex(b);
      let guard = 0;
      while (recent.some(r => hueGap(r, ci) < 3) && guard < COVER_COLORS.length) {
        ci = (ci + 1) % COVER_COLORS.length; guard++;
      }
      recent.push(ci);
      if (recent.length > 4) recent.shift();
      const hasImg = !!b.cover;
      const coverStyle = hasImg
        ? `background-image:url(${b.cover});background-size:cover;background-position:center;background-color:#2a3a36`
        : `background:${COVER_COLORS[ci]};--spine:${SPINE_COLORS[ci]}`;
      return `
        <div class="book-card" data-bid="${b.id}">
          <div class="book-cover${hasImg ? ' has-img' : ''}" style="${coverStyle}">
            <div class="bc-inner">
              <div class="bc-title">${esc(b.name)}</div>
              <div class="bc-rule"></div>
              <div class="bc-author">${esc(b.author || '白泽')}</div>
            </div>
          </div>
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

  /* ---------------- 继续写作 ----------------
   * 打开 App 最想干的事就是接着上次写,不该让用户点两次才到。
   */
  function renderResume() {
    const box = $('resume-card');
    const books = DB.books().filter(b => !b.flag);
    const alive = new Set(books.map(b => b.id));
    const arts = DB.all('article')
      .filter(a => alive.has(a.bookId))
      .sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0));
    if (!arts.length) { box.classList.add('hidden'); return; }
    const a = arts[0];
    const bk = DB.get('book', a.bookId);
    if (!bk) { box.classList.add('hidden'); return; }

    const words = DB.countWords(a.text || '');
    const ago = agoText(a.updateTime);
    box.innerHTML = `
      <div class="rc-main">
        <div class="rc-kicker">继续写作</div>
        <div class="rc-book">《${esc(bk.name)}》</div>
        <div class="rc-chap">${esc(a.name || '未命名章节')}</div>
        <div class="rc-meta">${words} 字 · ${ago}</div>
      </div>
      <button class="rc-go" aria-label="继续">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </button>`;
    box.classList.remove('hidden');
    box.onclick = () => openEditor(a.id);
  }

  function agoText(ts) {
    if (!ts) return '还没动笔';
    const d = Date.now() - ts;
    if (d < 60e3) return '刚刚';
    if (d < 3600e3) return Math.floor(d / 60e3) + ' 分钟前';
    if (d < 86400e3) return Math.floor(d / 3600e3) + ' 小时前';
    if (d < 7 * 86400e3) return Math.floor(d / 86400e3) + ' 天前';
    const t = new Date(ts), p = n => String(n).padStart(2, '0');
    return `${t.getMonth() + 1}月${t.getDate()}日`;
  }

  /* ---------------- 搜索 ---------------- */
  let searchOn = false;

  function toggleSearch(on) {
    searchOn = on === undefined ? !searchOn : on;
    $('search-wrap').classList.toggle('hidden', !searchOn);
    $('group-bar').style.display = searchOn ? 'none' : '';
    $('book-grid').classList.toggle('hidden', searchOn);
    $('search-result').classList.toggle('hidden', !searchOn);
    if (searchOn) {
      $('resume-card').classList.add('hidden');
      $('search-input').value = '';
      $('search-result').innerHTML = '';
      setTimeout(() => $('search-input').focus(), 60);
    } else {
      renderResume();
    }
  }

  function doSearch(q) {
    q = (q || '').trim();
    const box = $('search-result');
    if (!q) { box.innerHTML = ''; return; }
    const low = q.toLowerCase();
    const books = DB.books().filter(b => !b.flag);
    const bookName = {};
    books.forEach(b => { bookName[b.id] = b.name; });

    const hits = [];
    // 书
    books.forEach(b => {
      if (String(b.name || '').toLowerCase().indexOf(low) >= 0) {
        hits.push({ kind: 'book', title: b.name, book: b.name, sub: `${DB.bookChapters(b.id).length} 章 · ${DB.bookWords(b.id)} 字`, onClick: () => openCatalog(b.id) });
      }
    });
    // 章节:标题 + 正文
    DB.all('article').forEach(a => {
      if (!bookName[a.bookId]) return;
      const inTitle = String(a.name || '').toLowerCase().indexOf(low) >= 0;
      const text = String(a.text || '');
      const at = text.toLowerCase().indexOf(low);
      if (!inTitle && at < 0) return;
      let sub;
      if (at >= 0) {
        const s = Math.max(0, at - 12);
        const frag = text.slice(s, at) + '\u0001' + text.slice(at, at + q.length) + '\u0002' + text.slice(at + q.length, at + q.length + 24);
        sub = '…' + esc(frag).replace(/\u0001/g, '<em>').replace(/\u0002/g, '</em>') + '…';
      } else {
        sub = `${a.wordsNumText || 0} 字`;
      }
      hits.push({ kind: 'chapter', title: a.name || '未命名章节', book: bookName[a.bookId], sub, onClick: () => openEditor(a.id) });
    });

    if (!hits.length) {
      box.innerHTML = `<div class="search-empty">没有找到「${esc(q)}」</div>`;
      return;
    }
    box.innerHTML = hits.slice(0, 60).map((h, i) => `
      <div class="sr-hit" data-i="${i}">
        <div class="sh-main">
          <div class="sh-t">${esc(h.title)}</div>
          <div class="sh-s"><span class="sh-book">《${esc(h.book)}》</span>${h.sub}</div>
        </div>
        <span class="sh-badge">${h.kind === 'book' ? '书' : '章节'}</span>
      </div>`).join('');
    box.querySelectorAll('.sr-hit').forEach(el => {
      el.addEventListener('click', () => hits[+el.dataset.i].onClick());
    });
  }

  function bookMenu(bid) {
    const b = DB.get('book', bid);
    if (!b) return;
    openSheet(b.name, `
      <div class="sheet-item" data-act="cover"><span class="si-icon">🖼</span>${b.cover ? '换一张封面' : '从相册选封面'}</div>
      ${b.cover ? '<div class="sheet-item" data-act="cover-reset"><span class="si-icon">↩️</span>恢复默认封面</div>' : ''}
      <div class="sheet-item" data-act="rename"><span class="si-icon">✏️</span>重命名</div>
      <div class="sheet-item" data-act="move"><span class="si-icon">📁</span>移到分组</div>
      <div class="sheet-item" data-act="export"><span class="si-icon">📤</span>导出全书 TXT</div>
      <div class="sheet-item danger" data-act="del"><span class="si-icon">🗑</span>删除书籍(进回收站)</div>
    `);
    $('sheet-body').querySelectorAll('.sheet-item').forEach(it => {
      it.addEventListener('click', () => {
        const act = it.dataset.act;
        closeSheet();
        if (act === 'cover') { pickCover(bid); return; }
        if (act === 'cover-reset') {
          DB.put('book', { id: bid, cover: '' });
          DB.flush();
          renderShelf(); toast('已恢复默认封面');
          return;
        }
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

  /* 搜索 */
  $('btn-search').addEventListener('click', () => toggleSearch());
  $('search-cancel').addEventListener('click', () => toggleSearch(false));
  $('search-input').addEventListener('input', e => doSearch(e.target.value));
  $('search-input').addEventListener('keydown', e => { if (e.key === 'Escape') toggleSearch(false); });

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
    const desc = (DB.settings().catOrder || 'asc') === 'desc';
    const chapters = DB.bookChapters(curBookId).sort((x, y) => (x.seq || 0) - (y.seq || 0));
    $('cat-book-meta').textContent = `${fmtWords(DB.bookWords(curBookId))}字 · ${chapters.length}章`;

    const vols = DB.volumes(curBookId);
    let html = '';
    let idx = 0;

    const renderChaps = (list, volId) => {
      if (!list.length) {
        return `<div class="empty" style="padding:26px 20px;font-size:13px">这一卷还没有章节</div>`;
      }
      const view = desc ? list.slice().reverse() : list;
      return view.map(c => {
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
      <div class="sheet-item" data-act="export"><span class="si-icon">📤</span>导出本卷 TXT</div>
      <div class="sheet-item danger" data-act="del"><span class="si-icon">🗑</span>删除卷(章节移到未分卷)</div>
    `);
    $('sheet-body').querySelectorAll('.sheet-item').forEach(it => {
      it.addEventListener('click', () => {
        const act = it.dataset.act; closeSheet();
        if (act === 'export') {
          const list = DB.articles(curBookId).filter(c => c.volumeId === vid).sort((a, b) => a.seq - b.seq);
          if (!list.length) { toast('这一卷还是空的'); return; }
          downloadText(`${v.name}.txt`, list.map(c => `${c.name}\n\n${c.text || ''}`).join('\n\n\n'));
          return;
        }
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
      <div class="sheet-item" data-act="up"><span class="si-icon">↑</span>上移一位</div>
      <div class="sheet-item" data-act="down"><span class="si-icon">↓</span>下移一位</div>
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
        } else if (act === 'up' || act === 'down') {
          DB.normalizeSeq(curBookId);
          if (DB.moveArticle(aid, act)) renderCatalog();
          else toast(act === 'up' ? '已经是第一章了' : '已经是最后一章了');
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
      <div class="sheet-item" data-act="outline"><span class="si-icon">📋</span>作品大纲</div>
      <div class="sheet-item" data-act="char"><span class="si-icon">👤</span>角色设定</div>
      <div class="sheet-item" data-act="idea"><span class="si-icon">💡</span>灵感记录</div>
      <div class="sheet-item" data-act="newvol"><span class="si-icon">📚</span>新建一卷</div>
      <div class="sheet-item" data-act="export"><span class="si-icon">📤</span>导出全书 TXT</div>
      <div class="sheet-item" data-act="rename"><span class="si-icon">✏️</span>重命名书籍</div>
    `);
    $('sheet-body').querySelectorAll('.sheet-item').forEach(it => {
      it.addEventListener('click', () => {
        const act = it.dataset.act; closeSheet();
        if (act === 'outline' || act === 'char' || act === 'idea') { openNotes(act); return; }
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

  /* 目录正序 / 倒序 */
  $('btn-cat-sort').addEventListener('click', () => {
    const cur = DB.settings().catOrder || 'asc';
    const next = cur === 'asc' ? 'desc' : 'asc';
    DB.setSetting('catOrder', next);
    renderCatalog();
    toast(next === 'desc' ? '目录:最新章在前' : '目录:从第一章开始');
  });

  /* ================= 写作辅助:大纲 / 角色 / 灵感 ================= */
  let noteKind = 'outline';
  const KIND_NAME = { outline: '作品大纲', char: '角色设定', idea: '灵感记录' };
  const KIND_EMPTY = {
    outline: '把整本书的骨架写在这儿:主线、转折、结局。<br>写正文前先理一遍,不容易写崩。',
    char: '记下每个角色的名字、身份、性格、口头禅。<br>写到一半忘了设定,回来翻一眼。',
    idea: '突然想到的句子、桥段、对话,先扔进来。<br>不马上记,转头就忘。',
  };

  function openNotes(kind) {
    if (!curBookId) { toast('先从书架选一本书'); return; }
    noteKind = kind || 'outline';
    const b = DB.get('book', curBookId);
    $('notes-book').textContent = b ? '《' + b.name + '》' : '';
    $('notes-title').textContent = KIND_NAME[noteKind];
    $('notes-tabs').querySelectorAll('.ntab').forEach(t =>
      t.classList.toggle('active', t.dataset.kind === noteKind));
    $('btn-notes-add').classList.toggle('hidden', noteKind === 'outline');
    renderNotes();
    show('view-notes');
  }

  function renderNotes() {
    const box = $('notes-body');
    if (noteKind === 'outline') {
      const o = DB.outline(curBookId);
      box.innerHTML = `
        <textarea class="note-editor" id="outline-text" placeholder="一、开局&#10;主角在……&#10;&#10;二、转折&#10;……">${esc(o ? o.text : '')}</textarea>
        <div class="note-actions">
          <button class="na-primary" id="outline-save">保存大纲</button>
        </div>`;
      $('outline-save').addEventListener('click', () => {
        DB.saveOutline(curBookId, $('outline-text').value);
        toast('大纲已保存');
      });
      return;
    }

    const list = DB.notes(curBookId, noteKind);
    if (!list.length) {
      box.innerHTML = `<div class="empty">${KIND_EMPTY[noteKind]}</div>`;
      return;
    }
    box.innerHTML = list.map(n => `
      <div class="note-card" data-nid="${n.id}">
        <div class="nc-head">
          <span class="nc-title">${esc(n.title || (noteKind === 'idea' ? '灵感' : '未命名角色'))}</span>
          <span class="nc-time">${agoText(n.updateTime)}</span>
        </div>
        <div class="nc-text">${esc(n.text || '')}</div>
      </div>`).join('');

    box.querySelectorAll('.note-card').forEach(el => {
      el.addEventListener('click', () => editNote(el.dataset.nid));
      bindLongPress(el, () => {
        const n = DB.get('note', el.dataset.nid);
        if (!n) return;
        openSheet(n.title || '这条记录', `
          <div class="sheet-item" data-act="edit"><span class="si-icon">✏️</span>编辑</div>
          <div class="sheet-item danger" data-act="del"><span class="si-icon">🗑</span>删除</div>
        `);
        $('sheet-body').querySelectorAll('.sheet-item').forEach(it => {
          it.addEventListener('click', () => {
            closeSheet();
            if (it.dataset.act === 'edit') editNote(n.id);
            else if (confirmBox('删除这条记录?')) { DB.del('note', n.id); renderNotes(); toast('已删除'); }
          });
        });
      });
    });
  }

  function editNote(nid) {
    const n = nid ? DB.get('note', nid) : null;
    const isNew = !n;
    const titleLabel = noteKind === 'char' ? '角色名' : '标题(可不填)';
    $('notes-body').innerHTML = `
      <input class="note-title-input" id="note-title" placeholder="${titleLabel}" value="${esc(n ? n.title : '')}">
      <textarea class="note-editor" id="note-text" placeholder="写点什么…">${esc(n ? n.text : '')}</textarea>
      <div class="note-actions">
        <button class="na-ghost" id="note-cancel">取消</button>
        <button class="na-primary" id="note-save">保存</button>
      </div>`;
    $('note-title').focus();
    $('note-cancel').addEventListener('click', renderNotes);
    $('note-save').addEventListener('click', () => {
      const title = $('note-title').value.trim();
      const text = $('note-text').value;
      if (!title && !text.trim()) { toast('内容还是空的'); return; }
      if (isNew) DB.addNote(curBookId, noteKind, title, text);
      else DB.put('note', { id: n.id, title, text, updateTime: Date.now() });
      renderNotes();
      toast('已保存');
    });
  }

  $('notes-tabs').querySelectorAll('.ntab').forEach(t => {
    t.addEventListener('click', () => openNotes(t.dataset.kind));
  });
  $('btn-notes-add').addEventListener('click', () => editNote(null));
  $('btn-notes-back').addEventListener('click', () => { renderCatalog(); show('view-catalog'); });

  /* ================= AI 扩写 / 续写 ================= */
  const AI_MODE_HINT = {
    expand: '写一句话,AI 会结合大纲、角色和上文把它铺成正文。',
    continue: '顺着上文往下写。可以不填,留空就让它自然推进。',
    polish: '把选中的文字润色一遍,保持原意和长度。',
    describe: '给一个对象(比如"雨夜的巷口"),写一段具体的环境或细节。',
  };
  const AI_MODE_PH = {
    expand: '比如:她把水果都扔了',
    continue: '接下来要发生的事(可不填)',
    polish: '选中的文字会作为原文,这里可补充要求',
    describe: '比如:雨夜的巷口',
  };

  function openAI() {
    if (!curArticle) return;
    const ta = $('ed-text');
    const selStart = ta.selectionStart || 0;
    const selEnd = ta.selectionEnd || 0;
    const sel = ta.value.slice(selStart, selEnd);
    const before = window.AI.tail(ta.value.slice(0, selStart), 1600);

    const o = DB.outline(curBookId);
    const chars = DB.notes(curBookId, 'char');
    const ctxInfo = [
      before ? '上文 ' + before.length + ' 字' : '本章还没有上文',
      o && o.text ? '大纲' : '',
      chars.length ? '角色 ' + chars.length + ' 个' : '',
    ].filter(Boolean).join(' · ');

    const ready = window.AI.hasKey();

    openSheet('AI 写作', `
      ${ready ? '' : `<div class="ai-warn">还没配置模型。<br>去 设置 → AI 扩写 填上 Base URL 和 API Key(DeepSeek、通义、Kimi 都行),就能用了。</div>`}
      <div class="ai-modes" id="ai-modes">
        <button class="ai-mode active" data-mode="expand">扩写</button>
        <button class="ai-mode" data-mode="continue">续写</button>
        <button class="ai-mode" data-mode="polish">润色</button>
        <button class="ai-mode" data-mode="describe">描写</button>
      </div>
      <div class="ai-hint" id="ai-hint">${AI_MODE_HINT.expand}<br>会带上:${ctxInfo || '本章内容'}</div>
      <textarea class="ai-input" id="ai-input" placeholder="${AI_MODE_PH.expand}"></textarea>
      <div class="ai-lens" id="ai-lens">
        <button data-len="150">短 · 150字</button>
        <button data-len="300" class="active">中 · 300字</button>
        <button data-len="500">长 · 500字</button>
      </div>
      <button class="ai-go" id="ai-go">${ready ? '开始生成' : '去设置里配置'}</button>
      <div class="ai-status" id="ai-status"></div>
      <textarea class="ai-out" id="ai-out" placeholder=""></textarea>
      <div class="ai-bar hidden" id="ai-bar">
        <button class="ai-ghost" id="ai-retry">重新生成</button>
        <button class="ai-primary" id="ai-apply">插入到正文</button>
      </div>
    `);

    let mode = 'expand';
    let len = 300;
    let busy = false;

    // 正文里选中了一句,就直接带进输入框 —— 想扩写的就是这句,不用再打一遍
    if (sel && sel.trim() && sel.length <= 500) $('ai-input').value = sel.trim();

    $('ai-modes').querySelectorAll('.ai-mode').forEach(b => {
      b.addEventListener('click', () => {
        mode = b.dataset.mode;
        $('ai-modes').querySelectorAll('.ai-mode').forEach(x => x.classList.toggle('active', x === b));
        $('ai-hint').innerHTML = AI_MODE_HINT[mode] + '<br>会带上:' + (ctxInfo || '本章内容');
        $('ai-input').placeholder = AI_MODE_PH[mode];
        $('ai-lens').style.display = (mode === 'polish') ? 'none' : '';
        if (mode === 'polish' && sel) $('ai-input').value = '';
        if (mode === 'polish' && !sel) $('ai-hint').innerHTML = '先在正文里选中要润色的文字,再点这里。';
      });
    });

    $('ai-lens').querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        len = +b.dataset.len;
        $('ai-lens').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      });
    });

    const setStatus = (html) => { $('ai-status').innerHTML = html; };

    async function run() {
      if (busy) return;
      if (!window.AI.hasKey()) { toast('先去设置里填 API Key'); return; }
      const instr = $('ai-input').value.trim();
      if (mode === 'polish' && !sel) { toast('先在正文里选中要润色的文字'); return; }
      if (mode !== 'polish' && !instr && mode !== 'continue') { toast('写点什么再生成'); return; }
      if (mode === 'continue' && !before) { toast('本章还没有上文,没东西可续'); return; }

      busy = true;
      const btn = $('ai-go');
      btn.disabled = true;
      btn.textContent = '生成中…';
      const out = $('ai-out');
      out.value = '';
      $('ai-bar').classList.add('hidden');
      setStatus('<span class="dot"></span>正在生成…');

      const ctx = {
        bookName: (DB.get('book', curBookId) || {}).name || '',
        chapterName: ($('ed-title').value || '').trim(),
        outline: o ? o.text : '',
        chars: chars,
        before: before,
        selection: sel,
        instruction: instr,
        length: len,
        mode: mode,
      };

      try {
        let got = '';
        let firstIn = true;
        const text = await window.AI.generate(ctx, delta => {
          got += delta;
          out.value = got;
          out.scrollTop = out.scrollHeight;
          if (firstIn) {
            // 输出区第一次有内容才从 display:none 变可见,这时再滚才滚得到
            firstIn = false;
            try { out.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
          }
          setStatus('<span class="dot"></span>正在生成… ' + got.length + ' 字');
        });
        const finalText = (text && text.length >= got.length) ? text : got;
        out.value = finalText;
        if (!finalText.trim()) {
          setStatus('模型没有返回内容,换个说法再试一次');
        } else {
          setStatus('生成完成 · ' + finalText.length + ' 字');
          $('ai-bar').classList.remove('hidden');
          $('ai-apply').textContent = sel ? '替换选中' : '插入到正文';
          try { $('ai-bar').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { }
        }
      } catch (e) {
        setStatus('失败:' + (e && e.message ? e.message : e));
      } finally {
        busy = false;
        btn.disabled = false;
        btn.textContent = '再生成一次';
      }
    }

    $('ai-go').addEventListener('click', () => {
      if (!window.AI.hasKey()) { closeSheet(); openSettings('ai'); return; }
      run();
    });
    $('ai-retry').addEventListener('click', run);

    $('ai-apply').addEventListener('click', () => {
      const text = $('ai-out').value.trim();
      if (!text) return;
      const v = ta.value;
      // 选区在打开面板时就被记下了,这里按当时的范围替换/插入
      const s = Math.min(selStart, v.length);
      const e = Math.min(Math.max(selEnd, selStart), v.length);
      if (e > s) ta.value = v.slice(0, s) + text + v.slice(e);
      else ta.value = v.slice(0, s) + (s > 0 && !/\n$/.test(v.slice(0, s)) ? '\n\n' : '') + text + v.slice(s);
      const pos = s + text.length;
      try { ta.setSelectionRange(pos, pos); } catch (err) { }
      closeSheet();
      trackSpeed();
      scheduleSave();
      updateEdMeta('编辑中…');
      toast('已写入正文');
    });
  }

  $('ed-tool-ai').addEventListener('click', openAI);

  /* ================= 编辑器 ================= */
  /* 正文字体预设:'' = 跟随主题衬线(默认,最有书卷气) */
  const FONT_PRESETS = {
    serif: '"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC","SimSun","NSimSun",serif',
    sans: '-apple-system,"HarmonyOS Sans SC","MiSans","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif',
    kai: '"Kaiti SC","STKaiti","KaiTi","楷体",serif',
    mono: '"SF Mono","JetBrains Mono",Menlo,Consolas,"Noto Sans Mono CJK SC",monospace',
  };

  function applyEditorStyle() {
    const s = DB.settings();
    const ta = $('ed-text');
    ta.style.fontSize = s.fontSize + 'px';
    ta.style.lineHeight = s.lineHeight;
    const fam = s.fontFamily || 'serif';
    ta.style.fontFamily = FONT_PRESETS[fam] || FONT_PRESETS.serif;
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
    renderShelf();
    renderResume();
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
          <div style="font-size:12px;color:var(--ink-3);margin-top:2px">${h.wordsNumText || 0} 字 · ${esc((h.text || '').slice(0, 24))}…</div>
        </div>
      </div>`).join('') : '<div class="empty" style="padding:30px 0">暂无历史版本<br>每次保存间隔 3 分钟以上会留快照</div>');

    $('sheet-body').querySelectorAll('[data-hid]').forEach(it => {
      it.addEventListener('click', () => {
        const h = hist.find(x => x.id === it.dataset.hid);
        if (!h) return;
        if (confirmBox('用这个版本覆盖当前正文?当前内容会先存一份历史。')) {
          const cur = $('ed-text').value;
          // 恢复版本前必须先强制存下当前内容,否则这次覆盖就撤不回来了
          DB.pushHistory(Object.assign({}, curArticle, { text: cur, wordsNumText: DB.countWords(cur) }), true);
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
      <div class="set-row" style="flex-wrap:wrap;gap:8px">
        <span class="sr-label" style="flex-basis:100%">智能排版<span class="sr-sub">一键整理本章格式,可先撤销</span></span>
        <button class="chip" data-fmt="all">全部整理</button>
        <button class="chip" data-fmt="blankLine">段落空行</button>
        <button class="chip" data-fmt="indent">首行缩进</button>
        <button class="chip" data-fmt="punct">成对标点</button>
        <button class="chip" data-fmt="trimTail">去行尾空格</button>
        <button class="chip" data-fmt="cjkSpace">中英文空格</button>
      </div>
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
          ${[['serif', '宋体(推荐)'], ['sans', '黑体'], ['kai', '楷体'], ['mono', '等宽']]
            .map(([k, n]) => `<option value="${k}" ${(s.fontFamily || 'serif') === k ? 'selected' : ''}>${n}</option>`).join('')}
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
    const apply = () => {
      const fs = +$('tp-size').value, lh = +$('tp-lh').value, ff = $('tp-font').value;
      $('tp-size-v').textContent = fs; $('tp-lh-v').textContent = lh;
      DB.setSetting('fontSize', fs); DB.setSetting('lineHeight', lh); DB.setSetting('fontFamily', ff);
      applyEditorStyle();
    };
    $('tp-size').addEventListener('input', apply);
    $('tp-lh').addEventListener('input', apply);
    $('tp-font').addEventListener('change', apply);

    /* 智能排版 */
    $('sheet-body').querySelectorAll('[data-fmt]').forEach(b => {
      b.addEventListener('click', () => {
        const ta = $('ed-text');
        const before = ta.value;
        const all = b.dataset.fmt === 'all';
        const opts = all
          ? { trimTail: true, blankLine: true, indent: true, punct: true, cjkSpace: false }
          : { trimTail: false, blankLine: false, indent: false, punct: false, cjkSpace: false, [b.dataset.fmt]: true };
        const after = DB.formatText(before, opts);
        if (after === before) { toast('本章格式已经是干净的'); return; }
        // 进历史,方便一键撤回(整章重写,必须强制留快照,不受节流限制)
        DB.pushHistory(Object.assign({}, curArticle, { text: before, wordsNumText: DB.countWords(before) }), true);
        ta.value = after;
        scheduleSave();
        closeSheet();
        toast('排版完成,原文已存进历史版本', 2400);
      });
    });
    $('sheet-body').querySelectorAll('[data-bg]').forEach(b => {
      b.addEventListener('click', () => {
        DB.setSetting('bg', b.dataset.bg);
        $('sheet-body').querySelectorAll('[data-bg]').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        applyEditorStyle();
      });
    });
  });

  /* 阅读模式(沉浸) */
  function setImmersive(on) {
    document.body.classList.toggle('reading', on);
    $('btn-exit-immersive').classList.toggle('hidden', !on);
  }
  $('ed-tool-reading').addEventListener('click', () => {
    setImmersive(!document.body.classList.contains('reading'));
    if (document.body.classList.contains('reading')) toast('沉浸写作:点右下角「退出沉浸」回来', 2200);
  });
  $('btn-exit-immersive').addEventListener('click', () => setImmersive(false));
  // 沉浸模式下双击正文也能退出
  $('ed-text').addEventListener('dblclick', () => {
    if (document.body.classList.contains('reading')) setImmersive(false);
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
    const padB = 24, padT = 14;
    const slot = (w - 16) / days.length;

    const cs = getComputedStyle(document.documentElement);
    const cv = (n, fb) => (cs.getPropertyValue(n) || '').trim() || fb;
    const brand = cv('--brand', '#17876d');
    const brand2 = cv('--brand-2', '#2ba98a');
    const empty = cv('--line', '#e2e9e7');
    const sub = cv('--ink-3', '#8d9a95');

    // 基线
    ctx.strokeStyle = empty; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(8, h - padB + .5); ctx.lineTo(w - 8, h - padB + .5); ctx.stroke();

    // 标签:每 3 根一个 + 最后一根(今天)。从右往左排,避免最后两个挤在一起
    const want = new Set();
    for (let i = 0; i < days.length; i += 3) want.add(i);
    want.add(days.length - 1);
    const sorted = [...want].sort((a, b) => a - b);
    const keep = [];
    for (let k = sorted.length - 1; k >= 0; k--) {
      if (!keep.length || keep[0] - sorted[k] >= 2) keep.unshift(sorted[k]);
    }
    const labelSet = new Set(keep);

    days.forEach((d, i) => {
      const bh = Math.max(d.v > 0 ? 3 : 2, (d.v / max) * (h - padB - padT));
      const bw = slot * 0.52;
      const x = 8 + i * slot + (slot - bw) / 2;
      const y = h - padB - bh;

      if (d.v > 0) {
        const g = ctx.createLinearGradient(0, y, 0, h - padB);
        g.addColorStop(0, brand2); g.addColorStop(1, brand);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = empty;
      }
      ctx.beginPath();
      const r = Math.min(bw / 2, 5);
      if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, [r, r, 0, 0]);
      else ctx.rect(x, y, bw, bh);
      ctx.fill();

      // 今天那根顶端点一下,好认
      if (i === days.length - 1 && d.v > 0) {
        ctx.fillStyle = brand;
        ctx.beginPath(); ctx.arc(x + bw / 2, y - 6, 2.2, 0, Math.PI * 2); ctx.fill();
      }

      if (labelSet.has(i)) {
        ctx.fillStyle = sub; ctx.font = '10px -apple-system,sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(d.label, x + bw / 2, h - 7);
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
    const info = DB.storageInfo();
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
        <div class="set-group-title">数据</div>
        <div class="set-row">
          <span class="sr-label">存储<span class="sr-sub">${info.engine} · ${info.articles} 章 · ${(info.chars / 10000).toFixed(1)} 万字 · ${info.history} 条历史</span></span>
          <span class="set-val">${info.engine === 'IndexedDB' ? '容量充足' : '容量受限'}</span>
        </div>
        <div class="set-row">
          <span class="sr-label">备份<span class="sr-sub">导出全部作品为 JSON 文件</span></span>
          <button class="chip" id="st-backup">导出</button>
        </div>
        <div class="set-row">
          <span class="sr-label">恢复<span class="sr-sub">从备份文件导入（会覆盖现有数据）</span></span>
          <button class="chip" id="st-restore">导入</button>
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
          <span class="sr-label">正文字体</span>
          <select id="st-font">
            ${[['serif', '宋体(推荐)'], ['sans', '黑体'], ['kai', '楷体'], ['mono', '等宽']]
              .map(([k, n]) => `<option value="${k}" ${(s.fontFamily || 'serif') === k ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="set-row">
          <span class="sr-label">写作背景</span>
          <select id="st-bg">
            ${[['default', '默认'], ['paper', '纸白'], ['sepia', '羊皮纸'], ['green', '护眼绿'], ['dark', '夜间']]
              .map(([k, n]) => `<option value="${k}" ${s.bg === k ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="set-group" id="set-ai">
        <div class="set-group-title">AI 扩写</div>
        <div class="set-row">
          <span class="sr-label">服务商<span class="sr-sub">选一个会自动填好地址和模型</span></span>
          <select id="st-ai-provider">
            ${Object.keys(window.AI.PROVIDERS).map(k => {
              const p = window.AI.PROVIDERS[k];
              return `<option value="${k}" ${(s.aiProvider || 'deepseek') === k ? 'selected' : ''}>${p.name}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="set-row col">
          <span class="sr-label">Base URL<span class="sr-sub">接口根地址,末尾的 /chat/completions 会自动补</span></span>
          <input type="text" id="st-ai-base" value="${esc(s.aiBaseUrl || '')}" placeholder="https://api.deepseek.com/v1">
        </div>
        <div class="set-row col">
          <span class="sr-label">API Key<span class="sr-sub">只存在本机,不会上传</span></span>
          <input type="password" id="st-ai-key" value="${esc(s.aiKey || '')}" placeholder="sk-...">
        </div>
        <div class="set-row col">
          <span class="sr-label">模型<span class="sr-sub">填服务商文档里的模型名</span></span>
          <input type="text" id="st-ai-model" value="${esc(s.aiModel || '')}" placeholder="deepseek-chat">
        </div>
        <div class="set-row">
          <span class="sr-label">发散程度<span class="sr-sub">越高越有想象力,越低越稳</span></span>
          <input type="range" id="st-ai-temp" min="0" max="1.5" step="0.1" value="${s.aiTemp === undefined ? 0.8 : s.aiTemp}">
          <span class="set-val" id="st-ai-temp-v">${s.aiTemp === undefined ? 0.8 : s.aiTemp}</span>
        </div>
        <div class="set-row">
          <span class="sr-label">边写边显示<span class="sr-sub">关掉则等整段生成完再出</span></span>
          <button class="chip ${s.aiStream === false ? '' : 'active'}" id="st-ai-stream">${s.aiStream === false ? '已关闭' : '已开启'}</button>
        </div>
        <div class="set-row">
          <span class="sr-label">连接测试<span class="sr-sub" id="st-ai-test-res">填完 Key 可以点一下</span></span>
          <button id="st-ai-test" class="tool-btn" style="padding:6px 14px">测试</button>
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

    $('st-backup').addEventListener('click', () => {
      const data = DB.exportAll();
      downloadText(`白泽写作备份-${DB.todayKey()}.json`, JSON.stringify(data));
      toast('备份已导出');
    });
    $('st-restore').addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const n = DB.importAll(JSON.parse(String(rd.result)));
            toast(`已恢复 ${n} 条记录`);
            renderShelf();
            renderSettings();
          } catch (e) {
            toast('导入失败：' + e.message);
          }
        };
        rd.readAsText(f);
      };
      inp.click();
    });

    $('st-theme').addEventListener('click', () => {
      const cur = DB.settings().theme;
      DB.setSetting('theme', cur === 'dark' ? 'light' : 'dark');
      applyEditorStyle(); renderSettings();
    });
    $('st-size').addEventListener('change', e => { DB.setSetting('fontSize', +e.target.value); applyEditorStyle(); renderSettings(); });
    $('st-lh').addEventListener('change', e => { DB.setSetting('lineHeight', +e.target.value); applyEditorStyle(); renderSettings(); });
    $('st-bg').addEventListener('change', e => { DB.setSetting('bg', e.target.value); applyEditorStyle(); });
    $('st-font').addEventListener('change', e => { DB.setSetting('fontFamily', e.target.value); applyEditorStyle(); });

    /* ---- AI 扩写 ---- */
    const AI = window.AI;
    $('st-ai-provider').addEventListener('change', e => {
      const p = AI.PROVIDERS[e.target.value];
      DB.setSetting('aiProvider', e.target.value);
      if (p && p.base) {
        DB.setSetting('aiBaseUrl', p.base);
        DB.setSetting('aiModel', p.model);
        $('st-ai-base').value = p.base;
        $('st-ai-model').value = p.model;
      }
    });
    $('st-ai-base').addEventListener('change', e => DB.setSetting('aiBaseUrl', e.target.value.trim()));
    $('st-ai-key').addEventListener('change', e => DB.setSetting('aiKey', e.target.value.trim()));
    $('st-ai-model').addEventListener('change', e => DB.setSetting('aiModel', e.target.value.trim()));
    $('st-ai-temp').addEventListener('input', e => {
      $('st-ai-temp-v').textContent = e.target.value;
      DB.setSetting('aiTemp', +e.target.value);
    });
    $('st-ai-stream').addEventListener('click', () => {
      const on = DB.settings().aiStream !== false;
      DB.setSetting('aiStream', !on);
      $('st-ai-stream').classList.toggle('active', on);
      $('st-ai-stream').textContent = on ? '已关闭' : '已开启';
    });
    $('st-ai-test').addEventListener('click', async () => {
      const res = $('st-ai-test-res');
      res.textContent = '测试中…';
      try {
        const txt = await AI.callLLM(
          [{ role: 'user', content: '只回复两个字:可以' }],
          { stream: false, maxTokens: 16, temperature: 0 }
        );
        res.textContent = '连通正常,模型回:' + (txt || '(空)').slice(0, 20);
        toast('连接正常');
      } catch (e) {
        res.textContent = '失败:' + (e && e.message ? e.message : e);
      }
    });

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
            <div style="font-size:13px;color:var(--ink-3);line-height:1.8;margin-bottom:14px">${esc(m.notes || '优化体验与修复问题')}</div>
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
          <div style="font-size:12px;color:var(--ink-3);margin-top:2px">${r.type === 'book' ? '整本' : '章节'} · ${r.wordsNumText || 0} 字 · ${fmtDate(r.createTime)}</div>
        </div>
        <span style="color:var(--brand);font-size:13px">恢复</span>
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

  /* focus: 'ai' 时滚到 AI 那一组,方便从 AI 面板直接跳过来配置 */
  function openSettings(focus) {
    renderSettings();
    show('view-settings');
    if (focus) {
      setTimeout(() => {
        const el = $('set-ai');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
        const k = $('st-ai-key');
        if (k) k.focus();
      }, 90);
    }
  }
  window.UI.openSettings = openSettings;

  $('btn-settings').addEventListener('click', () => openSettings());
  $('btn-set-back').addEventListener('click', () => { renderShelf(); show('view-shelf'); });

  /* ================= 启动 ================= */
  async function boot() {
    await DB.ready;
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
    renderResume();

    // 静默检查更新
    window.Update.silentCheck((m) => {
      openSheet('发现新版本 v' + m.versionName, `
        <div style="font-size:13px;color:var(--ink-3);line-height:1.8;margin-bottom:14px">${esc(m.notes || '')}</div>
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

  boot().then(() => checkLock());
})();

/* ===== 白泽写作 - 数据层 v2 =====
 * 对齐口袋写作原版 7 表 schema:
 * tb_group  分组(书架分组)
 * tb_book   书籍
 * tb_volume 卷
 * tb_article 章节
 * tb_history 历史版本快照
 * tb_recycle 回收站
 * tb_stat   每日写作统计
 */
(function () {
  const K = {
    group: 'group', book: 'book', volume: 'volume',
    article: 'article', history: 'history', recycle: 'recycle',
    stat: 'stat', settings: 'settings', meta: 'meta',
  };

  const TABLES = ['group', 'book', 'volume', 'article', 'history', 'recycle', 'stat'];
  const KVS = ['settings', 'meta'];

  /* ---------------- 存储层 ----------------
   * 内存缓存 + IndexedDB 落盘。
   * 关键:put 只写单条记录,不会因为整本书变大而越来越慢;
   * 容量也从 localStorage 的 5~10MB 提到几百 MB。
   * IndexedDB 不可用时自动回退 localStorage。
   */
  const mem = {};
  TABLES.forEach(t => { mem[t] = []; });
  mem.settings = {};
  mem.meta = { lastVersionCheck: 0 };

  let idb = null;
  let loaded = false;
  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });

  function openDB() {
    return new Promise((res, rej) => {
      let settled = false;
      const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
      // 某些 WebView / 无头环境里 open 可能既不成功也不失败,必须兜底
      const timer = setTimeout(() => done(rej, new Error('idb open timeout')), 3000);
      let req;
      try { req = indexedDB.open('baize_writing', 1); } catch (e) { return done(rej, e); }
      req.onupgradeneeded = ev => {
        const db = ev.target.result;
        TABLES.forEach(t => {
          if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
        });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      };
      req.onsuccess = ev => done(res, ev.target.result);
      req.onerror = () => done(rej, req.error || new Error('idb open failed'));
      req.onblocked = () => done(rej, new Error('idb blocked'));
    });
  }

  const store = (name, mode) => idb.transaction(name, mode).objectStore(name);

  /* ---- 写入事务追踪 ----
   * put/del 是"发出去就不管"的:如果进程紧接着被杀(用户划掉 App),
   * 还没提交的事务会一起丢掉,表现就是"最后写的一段没了"。
   * 所以每个写事务都挂一个完成回调,串成链条,由 flush() 统一等待。
   */
  let txSeq = Promise.resolve();
  function trackTx(tx) {
    const done = new Promise(res => {
      tx.oncomplete = res;
      tx.onerror = res;
      tx.onabort = res;
    });
    txSeq = txSeq.then(() => done);
    return done;
  }
  function writeTx(name) {
    const tx = idb.transaction(name, 'readwrite');
    trackTx(tx);
    return tx.objectStore(name);
  }

  function idbAll(name) {
    return new Promise(res => {
      try {
        const r = store(name, 'readonly').getAll();
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => res([]);
      } catch (e) { res([]); }
    });
  }
  function idbPut(name, obj) {
    try { writeTx(name).put(obj); } catch (e) { }
  }
  function idbDel(name, id) {
    try { writeTx(name).delete(id); } catch (e) { }
  }
  function idbReplace(name, list) {
    try {
      const os = writeTx(name);
      os.clear();
      (list || []).forEach(o => os.put(o));
    } catch (e) { }
  }
  function kvGet(k) {
    return new Promise(res => {
      try {
        const r = store('kv', 'readonly').get(k);
        r.onsuccess = () => res(r.result ? r.result.v : null);
        r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }
  function kvPut(k, v) {
    try { writeTx('kv').put({ k, v }); } catch (e) { }
  }
  /* 等待所有已发出的写入真正落盘 */
  function flush() { return txSeq; }

  /* 旧版 localStorage 数据迁移 */
  async function migrateFromLS() {
    const hasData = TABLES.some(t => mem[t].length) ||
      Object.keys(mem.settings || {}).length > 0;
    if (hasData) return false;
    let found = false;
    for (const t of TABLES) {
      try {
        const raw = localStorage.getItem('bz_' + t);
        if (!raw) continue;
        const list = JSON.parse(raw);
        if (Array.isArray(list) && list.length) {
          mem[t] = list;
          list.forEach(o => idbPut(t, o));
          found = true;
        }
      } catch (e) { }
    }
    for (const k of KVS) {
      try {
        const raw = localStorage.getItem('bz_' + k);
        if (!raw) continue;
        const v = JSON.parse(raw);
        if (v && typeof v === 'object') { mem[k] = v; kvPut(k, v); found = true; }
      } catch (e) { }
    }
    return found;
  }

  function loadFromLS() {
    for (const t of TABLES) {
      try {
        const v = localStorage.getItem('bz_' + t);
        mem[t] = v ? JSON.parse(v) : [];
      } catch (e) { mem[t] = []; }
    }
    for (const k of KVS) {
      try {
        const v = localStorage.getItem('bz_' + k);
        if (v) mem[k] = JSON.parse(v);
      } catch (e) { }
    }
  }

  const persistLS = k => {
    try { localStorage.setItem('bz_' + k, JSON.stringify(mem[k])); } catch (e) {
      console.error('本地存储写入失败(可能已满)', e);
    }
  };

  async function load() {
    try {
      idb = await openDB();
      for (const t of TABLES) {
        const rows = await idbAll(t);
        // 加载期间若已有写入(理论上不会,防御一下),以内存里更新的为准
        if (!mem[t].length) mem[t] = rows;
        else {
          const ids = new Set(mem[t].map(x => x.id));
          rows.forEach(r => { if (!ids.has(r.id)) mem[t].push(r); });
        }
      }
      for (const k of KVS) {
        const v = await kvGet(k);
        if (v && typeof v === 'object' && !Object.keys(mem[k] || {}).length) mem[k] = v;
      }
      const migrated = await migrateFromLS();
      if (migrated) console.log('[db] 已从 localStorage 迁移到 IndexedDB');
    } catch (e) {
      console.warn('[db] IndexedDB 不可用,回退 localStorage', e);
      idb = null;
      loadFromLS();
    }
    loaded = true;
    resolveReady({ idb: !!idb });
  }

  /* 同步读写(内存),落盘异步 */
  const read = (k, d) => (mem[k] === undefined ? d : mem[k]);

  const write = (k, v) => {
    mem[k] = v;
    if (idb) {
      if (TABLES.indexOf(k) >= 0) idbReplace(k, v);
      else kvPut(k, v);
    } else {
      persistLS(k);
    }
    return true;
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = () => Date.now();

  /* 中文字数:汉字按 1,英文按词,标点不计 */
  function countWords(s) {
    if (!s) return 0;
    const cn = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const en = (s.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[a-zA-Z0-9]+/g) || []).length;
    return cn + en;
  }

  const DB = {
    uid, countWords, ready, flush,
    /* 同步健康状态,便于自检/排查(不需 await) */
    get health() { return { loaded, engine: idb ? 'IndexedDB' : 'localStorage' }; },

    /* ---------- 通用 ---------- */
    all(kind) { return (mem[K[kind]] || []).slice(); },
    save(kind, list) { return write(K[kind], list); },
    get(kind, id) { return this.all(kind).find(x => x.id === id) || null; },
    put(kind, obj) {
      const key = K[kind];
      const list = mem[key];
      const i = list.findIndex(x => x.id === obj.id);
      let rec;
      if (i >= 0) { rec = Object.assign({}, list[i], obj); list[i] = rec; }
      else { rec = obj; list.unshift(rec); }
      if (idb) idbPut(key, rec); else persistLS(key);
      return obj;
    },
    del(kind, id) {
      const key = K[kind];
      mem[key] = mem[key].filter(x => x.id !== id);
      if (idb) idbDel(key, id); else persistLS(key);
    },

    /* ---------- 分组 ---------- */
    groups() { return this.all('group').sort((a, b) => a.seq - b.seq); },
    addGroup(name, remarks) {
      const g = { id: uid(), name, remarks: remarks || '', seq: this.all('group').length, createTime: now(), updateTime: now() };
      this.put('group', g); return g;
    },

    /* ---------- 书籍 ---------- */
    books(groupId) {
      let l = this.all('book');
      if (groupId) l = l.filter(b => b.groupId === groupId);
      return l.sort((a, b) => (a.seq - b.seq) || (b.updateTime - a.updateTime));
    },
    addBook(name, groupId) {
      const b = {
        id: uid(), name: name || '未命名书籍', author: '', cover: '', brief: '',
        flag: 0, groupId: groupId || '', seq: this.books(groupId).length,
        createTime: now(), updateTime: now(),
      };
      this.put('book', b); return b;
    },
    /* 书籍总字数 = 各章 wordsNumText 之和 */
    bookWords(bookId) {
      return this.all('article').filter(a => a.bookId === bookId)
        .reduce((s, a) => s + (a.wordsNumText || 0), 0);
    },
    bookChapters(bookId) { return this.all('article').filter(a => a.bookId === bookId); },

    /* ---------- 卷 ---------- */
    volumes(bookId) {
      return this.all('volume').filter(v => v.bookId === bookId).sort((a, b) => a.seq - b.seq);
    },
    addVolume(bookId, name) {
      const v = { id: uid(), bookId, name: name || '未命名卷', seq: this.volumes(bookId).length, createTime: now(), updateTime: now() };
      this.put('volume', v); return v;
    },

    /* ---------- 章节 ---------- */
    articles(bookId, volumeId) {
      let l = this.all('article').filter(a => a.bookId === bookId);
      if (volumeId !== undefined) l = l.filter(a => (a.volumeId || '') === (volumeId || ''));
      return l.sort((a, b) => a.seq - b.seq);
    },
    addArticle(bookId, volumeId, name) {
      const a = {
        id: uid(), bookId, volumeId: volumeId || '', name: name || '新章节',
        type: 0, brief: '', seq: this.articles(bookId).length,
        wordsNumText: 0, wordsNumAll: 0, text: '',
        createTime: now(), updateTime: now(),
      };
      this.put('article', a);
      this.put('book', { id: bookId, updateTime: now() });
      return a;
    },
    /* 保存章节内容,并记录统计增量 */
    saveArticle(id, text) {
      const a = this.get('article', id);
      if (!a) return null;
      const newWords = countWords(text);
      const delta = newWords - (a.wordsNumText || 0);
      a.text = text;
      a.wordsNumText = newWords;
      a.wordsNumAll = newWords;
      a.brief = (text || '').replace(/\s+/g, ' ').slice(0, 60);
      a.updateTime = now();
      this.put('article', a);
      this.put('book', { id: a.bookId, updateTime: now() });
      if (delta > 0) this.addStat(delta);
      return a;
    },

    /* ---------- 历史版本 ---------- */
    HISTORY_INTERVAL: 3 * 60 * 1000,
    HISTORY_KEEP: 20,
    history(articleId) {
      return this.all('history').filter(h => h.articleId === articleId).sort((a, b) => b.createTime - a.createTime);
    },
    pushHistory(article) {
      if (!article) return false;
      const mine = this.history(article.id);
      if (mine.length && now() - mine[0].createTime < this.HISTORY_INTERVAL) return false;
      if (mine.length && mine[0].text === article.text) return false;
      const h = {
        id: uid(), articleId: article.id, text: article.text,
        wordsNumText: article.wordsNumText, wordsNumAll: article.wordsNumAll,
        createTime: now(), updateTime: now(),
      };
      this.put('history', h);
      // 超量清理:逐条删,避免整表重写
      const all = this.all('history');
      const mineAll = all.filter(x => x.articleId === article.id).sort((a, b) => b.createTime - a.createTime);
      mineAll.slice(this.HISTORY_KEEP).forEach(x => this.del('history', x.id));
      return true;
    },

    /* ---------- 回收站 ---------- */
    recycle() { return this.all('recycle').sort((a, b) => b.createTime - a.createTime); },
    /* 删除章节 → 进回收站 */
    trashArticle(id) {
      const a = this.get('article', id);
      if (!a) return;
      const book = this.get('book', a.bookId);
      this.put('recycle', {
        id: uid(), type: 'article', refId: a.id, name: a.name,
        bookName: book ? book.name : '', text: a.text,
        wordsNumText: a.wordsNumText, wordsNumAll: a.wordsNumAll,
        createTime: now(), updateTime: now(),
      });
      this.del('article', id);
    },
    /* 删除书籍 → 整本进回收站(只存书信息,章节仍在,可恢复) */
    trashBook(id) {
      const b = this.get('book', id);
      if (!b) return;
      this.put('recycle', {
        id: uid(), type: 'book', refId: b.id, name: b.name,
        bookName: b.name, text: '', wordsNumText: this.bookWords(id), wordsNumAll: 0,
        createTime: now(), updateTime: now(),
      });
      this.put('book', { id: b.id, flag: 1 }); // 标记删除
    },
    restore(recycleId) {
      const r = this.get('recycle', recycleId);
      if (!r) return;
      if (r.type === 'book') this.put('book', { id: r.refId, flag: 0 });
      if (r.type === 'article') {
        const src = r;
        this.put('article', {
          id: uid(), bookId: '', volumeId: '', name: src.name, type: 0, brief: '',
          seq: 0, wordsNumText: src.wordsNumText, wordsNumAll: src.wordsNumAll,
          text: src.text, createTime: now(), updateTime: now(),
        });
      }
      this.del('recycle', recycleId);
    },

    /* ---------- 统计 ---------- */
    todayKey() {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    },
    /* 按日期聚合,防止同一天出现多条记录(导入备份/历史遗留)导致重复累加 */
    stats() {
      const byDate = {};
      this.all('stat').forEach(s => {
        if (!s || !s.date) return;
        const t = byDate[s.date];
        if (!t) { byDate[s.date] = Object.assign({}, s); return; }
        t.wordsTxtInput += (s.wordsTxtInput || 0);
        t.wordsAllInput += (s.wordsAllInput || 0);
        t.writeDuration += (s.writeDuration || 0);
        t.idleDuration += (s.idleDuration || 0);
        if ((s.updateTime || 0) > (t.updateTime || 0)) t.updateTime = s.updateTime;
      });
      return Object.keys(byDate).sort((a, b) => a < b ? 1 : -1).map(k => byDate[k]);
    },
    addStat(deltaWords, deltaDurationSec) {
      const date = this.todayKey();
      let s = this.all('stat').find(x => x.date === date);
      if (!s) {
        s = { id: uid(), date, wordsTxtInput: 0, wordsAllInput: 0, wordsTxtTotal: 0, wordsAllTotal: 0, writeDuration: 0, idleDuration: 0, createTime: now(), updateTime: now() };
      }
      s.wordsTxtInput += (deltaWords || 0);
      s.wordsAllInput += (deltaWords || 0);
      s.writeDuration += (deltaDurationSec || 0);
      s.updateTime = now();
      this.put('stat', s);
      // 更新总量
      const total = this.all('article').reduce((n, a) => n + (a.wordsNumText || 0), 0);
      s.wordsTxtTotal = total; s.wordsAllTotal = total;
      this.put('stat', s);
      return s;
    },
    /* 连续写作天数 */
    streak() {
      const dates = new Set(this.stats().map(s => s.date));
      let n = 0;
      const d = new Date();
      for (;;) {
        const p = x => String(x).padStart(2, '0');
        const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        if (dates.has(key)) { n++; d.setDate(d.getDate() - 1); }
        else if (n === 0 && key === this.todayKey()) { d.setDate(d.getDate() - 1); } // 今天还没写,从昨天算
        else break;
      }
      return n;
    },
    totalWords() { return this.all('article').reduce((n, a) => n + (a.wordsNumText || 0), 0); },

    /* ---------- 设置 ---------- */
    settings() {
      return Object.assign({
        fontSize: 17, lineHeight: 1.9, fontFamily: '', bg: 'default',
        readingMode: false, theme: 'light', autoUpdate: true,
        updateUrl: '', voiceMode: 'ime', // ime = 输入法语音(默认) | system = 系统识别
        dailyGoal: 2000,   // 每日字数目标
        lockCode: '',      // 应用锁 PIN,空表示未开启
      }, read(K.settings, {}));
    },
    setSetting(k, v) {
      const s = this.settings(); s[k] = v; write(K.settings, s);
    },
    meta() { return read(K.meta, { lastVersionCheck: 0 }); },
    setMeta(k, v) { const m = this.meta(); m[k] = v; write(K.meta, m); },

    /* ---------- 全量备份 ---------- */
    exportAll() {
      const out = { app: 'baize-writing', format: 1, exportedAt: now(), tables: {}, settings: mem.settings };
      TABLES.forEach(t => { out.tables[t] = mem[t]; });
      return out;
    },
    importAll(data) {
      if (!data || typeof data !== 'object' || !data.tables) throw new Error('文件格式不对');
      TABLES.forEach(t => {
        const list = Array.isArray(data.tables[t]) ? data.tables[t] : [];
        mem[t] = list;
        if (idb) idbReplace(t, list);
      });
      if (data.settings && typeof data.settings === 'object') {
        mem.settings = data.settings;
        if (idb) kvPut('settings', data.settings);
      }
      return TABLES.reduce((n, t) => n + mem[t].length, 0);
    },
    storageInfo() {
      return {
        engine: idb ? 'IndexedDB' : 'localStorage',
        articles: mem.article.length,
        chars: mem.article.reduce((n, a) => n + (a.text ? a.text.length : 0), 0),
        history: mem.history.length,
      };
    },
  };

  window.DB = DB;

  /* 关键:必须主动启动加载,否则 ready 永不 resolve,boot() 会一直挂着 */
  load();
})();

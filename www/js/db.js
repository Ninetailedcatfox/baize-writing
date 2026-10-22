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
    group: 'bz_group', book: 'bz_book', volume: 'bz_volume',
    article: 'bz_article', history: 'bz_history', recycle: 'bz_recycle',
    stat: 'bz_stat', settings: 'bz_settings', meta: 'bz_meta',
  };

  const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { console.error('save fail', k, e); return false; } };
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
    uid, countWords,

    /* ---------- 通用 ---------- */
    all(kind) { return read(K[kind], []); },
    save(kind, list) { return write(K[kind], list); },
    get(kind, id) { return this.all(kind).find(x => x.id === id) || null; },
    put(kind, obj) {
      const list = this.all(kind);
      const i = list.findIndex(x => x.id === obj.id);
      if (i >= 0) list[i] = Object.assign({}, list[i], obj);
      else list.unshift(obj);
      this.save(kind, list);
      return obj;
    },
    del(kind, id) { this.save(kind, this.all(kind).filter(x => x.id !== id)); },

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
    HISTORY_KEEP: 40,
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
      // 超量清理
      const all = this.all('history');
      const mineAll = all.filter(x => x.articleId === article.id).sort((a, b) => b.createTime - a.createTime);
      const drop = new Set(mineAll.slice(this.HISTORY_KEEP).map(x => x.id));
      if (drop.size) this.save('history', all.filter(x => !drop.has(x.id)));
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
    stats() { return this.all('stat').sort((a, b) => a.date < b.date ? 1 : -1); },
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
  };

  window.DB = DB;
})();

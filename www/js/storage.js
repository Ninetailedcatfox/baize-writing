/* ===== 存储层 =====
 * v1 用 localStorage;数据模型对照口袋写作逆向出的 schema 简化:
 * article: {id, title, content, groupId, createTime, updateTime, wordCount}
 * group:   {id, name, order}
 * history: {id, articleId, content, wordCount, saveTime}
 */
(function () {
  const KEYS = {
    articles: 'bz_articles',
    groups: 'bz_groups',
    history: 'bz_history',
    settings: 'bz_settings',
  };

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('[storage] load fail', key, e);
      return fallback;
    }
  }
  function save(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      console.error('[storage] save fail', key, e);
      return false;
    }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  window.Storage = {
    uid,

    /* ---- 文章 ---- */
    getArticles() { return load(KEYS.articles, []); },
    saveArticles(list) { return save(KEYS.articles, list); },
    getArticle(id) { return this.getArticles().find(a => a.id === id) || null; },
    upsertArticle(art) {
      const list = this.getArticles();
      const i = list.findIndex(a => a.id === art.id);
      if (i >= 0) list[i] = art; else list.unshift(art);
      return save(KEYS.articles, list);
    },
    deleteArticle(id) {
      const list = this.getArticles().filter(a => a.id !== id);
      save(KEYS.articles, list);
      // 连带删除历史
      const hist = load(KEYS.history, []).filter(h => h.articleId !== id);
      save(KEYS.history, hist);
    },

    /* ---- 分组 ---- */
    getGroups() { return load(KEYS.groups, []); },
    saveGroups(list) { return save(KEYS.groups, list); },
    addGroup(name) {
      const list = this.getGroups();
      if (list.some(g => g.name === name)) return null;
      const g = { id: uid(), name, order: list.length };
      list.push(g);
      save(KEYS.groups, list);
      return g;
    },
    deleteGroup(id) {
      save(KEYS.groups, this.getGroups().filter(g => g.id !== id));
    },

    /* ---- 历史版本 ----
     * 规则:距上一份快照超过 5 分钟才存,保留最近 50 条 */
    HISTORY_MIN_INTERVAL: 5 * 60 * 1000,
    HISTORY_KEEP: 50,
    getHistory(articleId) {
      return load(KEYS.history, [])
        .filter(h => h.articleId === articleId)
        .sort((a, b) => b.saveTime - a.saveTime);
    },
    pushHistory(article) {
      const all = load(KEYS.history, []);
      const mine = all.filter(h => h.articleId === article.id)
        .sort((a, b) => b.saveTime - a.saveTime);
      if (mine.length && Date.now() - mine[0].saveTime < this.HISTORY_MIN_INTERVAL) return false;
      if (mine.length && mine[0].content === article.content) return false;
      all.push({
        id: uid(),
        articleId: article.id,
        content: article.content,
        wordCount: article.wordCount || 0,
        saveTime: Date.now(),
      });
      // 清理超额
      const mineAll = all.filter(h => h.articleId === article.id)
        .sort((a, b) => b.saveTime - a.saveTime);
      const drop = new Set(mineAll.slice(this.HISTORY_KEEP).map(h => h.id));
      save(KEYS.history, all.filter(h => !drop.has(h.id)));
      return true;
    },
    clearHistory(articleId) {
      save(KEYS.history, load(KEYS.history, []).filter(h => h.articleId !== articleId));
    },

    /* ---- 设置 ---- */
    getSettings() { return load(KEYS.settings, {}); },
    setSetting(k, v) {
      const s = this.getSettings();
      s[k] = v;
      save(KEYS.settings, s);
    },

    /* ---- 导出/导入(数据搬家) ---- */
    exportAll() {
      return JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        articles: this.getArticles(),
        groups: this.getGroups(),
        history: load(KEYS.history, []),
      });
    },
    importAll(jsonStr) {
      const data = JSON.parse(jsonStr);
      if (!data.articles) throw new Error('格式不对');
      save(KEYS.articles, data.articles);
      if (data.groups) save(KEYS.groups, data.groups);
      if (data.history) save(KEYS.history, data.history);
    },
  };
})();

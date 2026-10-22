/* ===== 白泽写作 · 创作工具集 =====
 * 起名器 / 查找替换 / 快捷输入 / 分享图 / 年度报告
 */
(function () {
  const $ = id => document.getElementById(id);
  const UI = () => window.UI;
  const rnd = a => a[Math.floor(Math.random() * a.length)];

  /* ================= 词库 ================= */

  const SURNAME = ('李王张刘陈杨赵黄周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛段雷侯龙史陶黎贺顾毛郝龚邵万钱严武戴莫孔向汤').split('');
  const SURNAME2 = ['欧阳', '上官', '司马', '诸葛', '东方', '独孤', '慕容', '南宫', '西门', '夏侯', '公孙', '长孙', '皇甫', '尉迟', '轩辕', '令狐', '端木', '澹台'];
  const MALE = '天玄尘寒墨辰昊霄轩逸泽川野峰岳霆骁战烈锋渊澈珩珏煜焱冥朔翊擎拓御苍霄临渡'.split('');
  const FEMALE = '雪月霜烟灵婉妍汐微晴语洛瑶璃薇蓉若卿渺诗画素心柔玉冰蝶然澜黛'.split('');
  const NEUTRAL = '云风青岚舟屿白书玄影序苏谙弦野烬'.split('');

  const SECT_PRE = ['天', '玄', '青', '紫', '血', '幽', '魔', '佛', '道', '剑', '药', '丹', '万', '千', '九', '太', '上', '无', '极', '凌', '云', '苍', '冥', '寒', '焚', '星', '月', '落', '沉', '浮'];
  const SECT_MID = ['', '', '', '阳', '阴', '元', '灵', '光', '霄', '岳', '海', '荒', '古', '罗'];
  const SECT_SUF = ['宗', '门', '派', '阁', '殿', '教', '谷', '山庄', '洞天', '府', '盟', '会', '堂', '寺', '观', '斋', '楼', '岛'];

  const EQUIP_QUAL = ['凡', '灵', '玄', '地', '天', '圣', '仙', '神', '魔', '龙', '九幽', '太初'];
  const EQUIP_MAT = ['铁', '铜', '银', '玉', '骨', '木', '石', '冰', '火', '雷', '血', '星'];
  const EQUIP_TYPE = ['剑', '刀', '枪', '戟', '弓', '甲', '袍', '靴', '冠', '戒', '镯', '珠', '幡', '印', '塔', '鼎', '扇', '鞭', '锤', '匕', '琴', '箫'];
  const EQUIP_SUF = ['之刃', '之心', '之魂', '无双', '无痕', '惊鸿', '断岳', '裂空', '诛邪', '镇魂', '焚天', '饮血', '斩月', '听风', '归墟'];

  const SKILL_VERB = ['破', '斩', '焚', '噬', '镇', '御', '引', '凝', '碎', '裂', '诛', '御', '踏', '渡', '吞'];
  const SKILL_ELEM = ['雷', '火', '冰', '风', '土', '金', '木', '水', '血', '光', '暗', '星', '月', '幽冥', '太虚'];
  const SKILL_SUF = ['诀', '术', '印', '阵', '咒', '斩', '击', '掌', '拳', '步', '身法', '神通', '真解', '秘典'];

  const PLACE_PRE = ['幽', '落', '苍', '云', '赤', '玄', '万', '千', '九', '寒', '碧', '青', '白', '黑', '紫', '金', '血', '星', '月', '天', '沉', '浮', '断'];
  const PLACE_MID = ['', '', '', '霞', '雾', '霜', '阳', '阴', '灵', '古', '荒', '冥'];
  const PLACE_SUF = ['山', '谷', '峰', '林', '原', '城', '镇', '关', '渡', '渊', '崖', '洞', '海', '湖', '泽', '川', '岭', '峡', '洲', '墟'];

  const MON_PRE = ['赤', '玄', '幽', '铁', '血', '骨', '腐', '冰', '炎', '雷', '毒', '影', '噬', '九', '三'];
  const MON_RACE = ['狼', '虎', '熊', '蟒', '蛛', '蝎', '蝠', '蛟', '龙', '猿', '尸', '鬼', '妖', '魔', '兽', '鹰', '蜈', '蟾'];

  const ITEM_PRE = ['聚', '回', '破', '隐', '疾', '金', '玉', '玄', '九', '三', '清', '定'];
  const ITEM_SUF = ['灵丹', '散', '露', '符', '玉简', '令牌', '令', '石', '晶', '果', '花', '草', '髓', '液'];

  /* ================= 生成器 ================= */

  function person(gender) {
    const sur = Math.random() < 0.12 ? rnd(SURNAME2) : rnd(SURNAME);
    const pool = gender === 'male' ? MALE : gender === 'female' ? FEMALE : NEUTRAL;
    const len = Math.random() < 0.45 ? 2 : 1;
    let given = '';
    for (let i = 0; i < len; i++) given += rnd(pool);
    return sur + given;
  }

  const GEN = {
    person: () => {
      const g = rnd(['male', 'female', 'neutral']);
      return person(g);
    },
    sect: () => rnd(SECT_PRE) + rnd(SECT_MID) + rnd(SECT_SUF),
    equip: () => {
      const style = Math.random();
      if (style < 0.35) return rnd(EQUIP_QUAL) + rnd(EQUIP_MAT) + rnd(EQUIP_TYPE);
      if (style < 0.7) return rnd(EQUIP_QUAL) + rnd(EQUIP_TYPE);
      return rnd(EQUIP_QUAL) + rnd(EQUIP_TYPE) + rnd(EQUIP_SUF);
    },
    skill: () => {
      const style = Math.random();
      if (style < 0.5) return rnd(SKILL_ELEM) + rnd(SKILL_VERB) + rnd(SKILL_SUF);
      return rnd(SKILL_VERB) + rnd(SKILL_ELEM) + rnd(SKILL_SUF);
    },
    place: () => rnd(PLACE_PRE) + rnd(PLACE_MID) + rnd(PLACE_SUF),
    monster: () => rnd(MON_PRE) + rnd(MON_RACE),
    item: () => rnd(ITEM_PRE) + rnd(ITEM_SUF),
  };

  const CATS = [
    { key: 'person', label: '人物' },
    { key: 'sect', label: '门派' },
    { key: 'equip', label: '装备' },
    { key: 'skill', label: '功法' },
    { key: 'place', label: '地名' },
    { key: 'monster', label: '怪物' },
    { key: 'item', label: '丹药' },
  ];

  /* ================= 起名器 ================= */

  let curCat = 'person';

  function genBatch(cat, n) {
    const out = new Set();
    let guard = 0;
    while (out.size < n && guard++ < n * 12) out.add(GEN[cat]());
    return [...out];
  }

  function renderNameList() {
    const list = genBatch(curCat, 12);
    $('ng-list').innerHTML = list.map(t =>
      `<button class="ng-item" data-v="${UI().esc(t)}">${UI().esc(t)}</button>`
    ).join('');
    $('ng-list').querySelectorAll('.ng-item').forEach(b => {
      b.addEventListener('click', () => {
        const v = b.dataset.v;
        if (navigator.clipboard) navigator.clipboard.writeText(v).catch(() => {});
        UI().toast('已复制：' + v);
      });
    });
  }

  function openNameGen() {
    UI().openSheet('起名器', `
      <div class="ng-cats">
        ${CATS.map(c => `<button class="chip ${c.key === curCat ? 'active' : ''}" data-cat="${c.key}">${c.label}</button>`).join('')}
      </div>
      <div id="ng-list" class="ng-list"></div>
      <div class="ng-foot">
        <button class="btn-ghost" id="ng-copy-all">复制全部</button>
        <button class="btn-primary" id="ng-again">换一批</button>
      </div>
    `);
    renderNameList();
    $('ng-cats') || null;
    document.querySelectorAll('.ng-cats .chip').forEach(b => {
      b.addEventListener('click', () => {
        curCat = b.dataset.cat;
        document.querySelectorAll('.ng-cats .chip').forEach(x => x.classList.toggle('active', x.dataset.cat === curCat));
        renderNameList();
      });
    });
    $('ng-again').addEventListener('click', renderNameList);
    $('ng-copy-all').addEventListener('click', () => {
      const all = [...document.querySelectorAll('.ng-item')].map(b => b.dataset.v).join('、');
      if (navigator.clipboard) navigator.clipboard.writeText(all).catch(() => {});
      UI().toast('已复制 12 个');
    });
  }

  /* ================= 查找替换 ================= */

  function openFindReplace() {
    const ta = $('ed-text');
    if (!ta) { UI().toast('先打开一章'); return; }
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);

    UI().openSheet('查找替换', `
      <div class="fr-box">
        <input id="fr-find" type="text" placeholder="查找内容" value="${UI().esc(sel)}">
        <input id="fr-rep" type="text" placeholder="替换为（留空则只查找）">
        <div class="fr-stat" id="fr-stat"></div>
        <div class="fr-actions">
          <button class="btn-ghost" id="fr-count">统计</button>
          <button class="btn-ghost" id="fr-next">下一个</button>
          <button class="btn-primary" id="fr-all">全部替换</button>
        </div>
      </div>
    `);

    let hitPos = -1;
    const find = () => $('fr-find').value;

    function countHits() {
      const q = find();
      if (!q) return 0;
      return ta.value.split(q).length - 1;
    }

    function showCount() {
      const n = countHits();
      $('fr-stat').textContent = find() ? `共 ${n} 处` : '';
      return n;
    }

    $('fr-count').addEventListener('click', showCount);

    $('fr-next').addEventListener('click', () => {
      const q = find();
      if (!q) return;
      const from = hitPos + 1;
      const i = ta.value.indexOf(q, from);
      if (i < 0) {
        hitPos = -1;
        UI().toast('已到末尾');
        return;
      }
      hitPos = i;
      ta.focus();
      ta.setSelectionRange(i, i + q.length);
      UI().closeSheet();
    });

    $('fr-all').addEventListener('click', () => {
      const q = find();
      if (!q) { UI().toast('请先输入查找内容'); return; }
      const rep = $('fr-rep').value;
      const n = countHits();
      if (!n) { UI().toast('没有找到'); return; }
      if (!rep) { UI().toast(`找到 ${n} 处，未填替换内容`); return; }
      ta.value = ta.value.split(q).join(rep);
      ta.dispatchEvent(new Event('input'));
      UI().closeSheet();
      UI().toast(`已替换 ${n} 处`);
    });
  }

  /* ================= 快捷输入 ================= */

  const QUICK_SETS = {
    '标点': ['，', '。', '、', '；', '：', '？', '！', '……', '——', '「', '」', '『', '』', '（', '）', '《', '》'],
    '转场': ['***', '◆ ◆ ◆', '※ ※ ※', '（本章完）', '——未完待续——'],
    '常用': ['说道', '心想', '缓缓', '忽然', '顿时', '只见', '不过', '然而', '与此同时', '话音未落'],
    '人称': ['他', '她', '我', '你', '众人', '对方', '此人', '那人'],
  };

  function openQuickInput() {
    const ta = $('ed-text');
    if (!ta) { UI().toast('先打开一章'); return; }

    UI().openSheet('快捷输入', Object.entries(QUICK_SETS).map(([name, items]) => `
      <div class="qi-group">
        <div class="qi-title">${UI().esc(name)}</div>
        <div class="qi-row">
          ${items.map(t => `<button class="qi-item" data-v="${UI().esc(t)}">${UI().esc(t)}</button>`).join('')}
        </div>
      </div>
    `).join(''));

    document.querySelectorAll('.qi-item').forEach(b => {
      b.addEventListener('click', () => {
        const v = b.dataset.v;
        const s = ta.selectionStart, e = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + v + ta.value.slice(e);
        const pos = s + v.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
        ta.dispatchEvent(new Event('input'));
        UI().closeSheet();
      });
    });
  }

  /* ================= 分享图 ================= */

  function makeShareImage() {
    const ta = $('ed-text');
    const title = ($('ed-title') && $('ed-title').value) || '未命名';
    if (!ta) { UI().toast('先打开一章'); return; }
    const text = ta.value.trim();
    if (!text) { UI().toast('这一章还是空的'); return; }

    const W = 1080, PAD = 88;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const bodyFont = '30px "Songti SC","Noto Serif CJK SC",serif';
    const titleFont = 'bold 46px "Songti SC","Noto Serif CJK SC",serif';

    ctx.font = bodyFont;
    const maxW = W - PAD * 2;
    const lines = [];
    for (const para of text.split('\n')) {
      if (!para) { lines.push(''); continue; }
      let cur = '';
      for (const ch of para) {
        if (ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; }
        else cur += ch;
      }
      if (cur) lines.push(cur);
    }

    const lineH = 54;
    const maxLines = 26;
    const shown = lines.slice(0, maxLines);
    const H = PAD * 2 + 96 + 40 + shown.length * lineH + 70;

    cv.width = W; cv.height = H;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#17876d';
    ctx.fillRect(0, 0, W, 8);

    ctx.fillStyle = '#14201d';
    ctx.font = titleFont;
    ctx.fillText(title.slice(0, 20), PAD, PAD + 46);

    ctx.fillStyle = '#17876d';
    ctx.fillRect(PAD, PAD + 70, 64, 5);

    ctx.fillStyle = '#2b3a36';
    ctx.font = bodyFont;
    let y = PAD + 96 + 40;
    for (const ln of shown) {
      if (ln) ctx.fillText(ln, PAD, y);
      y += lineH;
    }

    ctx.fillStyle = '#8d9a95';
    ctx.font = '24px -apple-system,sans-serif';
    const tail = lines.length > maxLines ? '……' : '';
    ctx.fillText(`${tail}  —  白泽写作`, PAD, H - 44);

    const dataUrl = cv.toDataURL('image/png');
    UI().openSheet('分享图', `
      <div class="share-wrap"><img src="${dataUrl}" alt="章节分享图"></div>
      <div style="padding:12px 22px 4px;display:flex;gap:10px">
        <button class="btn-ghost" id="share-save" style="flex:1">保存图片</button>
        <button class="btn-primary" id="share-close" style="flex:1">关闭</button>
      </div>
    `);
    $('share-close').addEventListener('click', () => UI().closeSheet());
    $('share-save').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${title}.png`;
      a.click();
      UI().toast('已保存到下载目录');
    });
  }

  /* ================= 年度报告 ================= */

  function openAnnualReport() {
    const DB = window.DB;
    const stats = DB.stats();
    const year = new Date().getFullYear();
    const ys = stats.filter(s => String(s.date).startsWith(String(year)));
    const totalWords = ys.reduce((n, s) => n + (s.wordsTxtInput || 0), 0);
    const totalMin = ys.reduce((n, s) => n + Math.round((s.writeDuration || 0) / 60), 0);
    const days = ys.filter(s => (s.wordsTxtInput || 0) > 0).length;
    const best = ys.slice().sort((a, b) => (b.wordsTxtInput || 0) - (a.wordsTxtInput || 0))[0];
    const books = DB.all('book').length;
    const chapters = DB.all('article').length;

    UI().openSheet(`${year} 年度报告`, `
      <div class="report">
        <div class="rp-hero">${year}</div>
        <div class="rp-grid">
          <div class="rp-cell"><b>${totalWords.toLocaleString()}</b><span>今年写字</span></div>
          <div class="rp-cell"><b>${days}</b><span>写作天数</span></div>
          <div class="rp-cell"><b>${Math.round(totalMin / 60)}</b><span>写作小时</span></div>
          <div class="rp-cell"><b>${books}</b><span>作品数</span></div>
          <div class="rp-cell"><b>${chapters}</b><span>章节数</span></div>
          <div class="rp-cell"><b>${best ? (best.wordsTxtInput || 0) : 0}</b><span>单日最高</span></div>
        </div>
        <div class="rp-note">${best ? `最高产的一天是 ${best.date}，写了 ${best.wordsTxtInput} 字。` : '还没有记录，今天开始写吧。'}</div>
      </div>
    `);
  }

  window.Tools = {
    openNameGen, openFindReplace, openQuickInput, makeShareImage, openAnnualReport,
  };
})();

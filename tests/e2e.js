/* v2.4 端到端回归:把这一轮修的东西钉住,防止以后改回去。
 * 覆盖:继续写作卡片 / 封面防撞色 / 搜索(含书名) / 沉浸模式 / 统计按日去重 / flush
 * 用法: node tests/e2e.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', 'www');
const PORT = 8831;
const CDP = 9281;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, p === '/' ? '/index.html' : p);
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(buf);
  });
});

const get = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP, path: p }, r => {
    let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res(b));
  }).on('error', rej);
});

let ws, id = 0;
const pend = new Map();
const send = (m, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
async function ev(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  const d = r.result;
  if (d.exceptionDetails) return 'EXC: ' + ((d.exceptionDetails.exception && d.exceptionDetails.exception.description) || d.exceptionDetails.text);
  return d.result ? d.result.value : undefined;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

const SEED = `(function(){
  const DB = window.DB;
  ['book','article','volume','group','stat','history','recycle'].forEach(t => DB.save(t, []));
  const names = ['测试书甲','测试书乙','测试书丙'];
  const chs = ['开头','中段','结尾'];
  const body = '青石巷口的灯一直亮着,照得雨丝发白。';
  const out = [];
  names.forEach((n, bi) => {
    const b = DB.addBook(n);
    for (let i = 0; i < 2; i++) {
      const a = DB.addArticle(b.id, '', chs[i]);
      DB.saveArticle(a.id, body + n);
      DB.put('article', { id: a.id, updateTime: Date.now() - (bi * 10 + i) * 60000 });
    }
    out.push(b.id);
  });
  // 故意造两条同一天的统计,验证去重
  DB.put('stat', { id: 'dup1', date: '2026-01-02', wordsTxtInput: 100, writeDuration: 60, updateTime: 1 });
  DB.put('stat', { id: 'dup2', date: '2026-01-02', wordsTxtInput: 250, writeDuration: 30, updateTime: 2 });
  return out.length;
})()`;

let pass = 0, fail = 0;
const log = [];
function ok(name, cond, extra) {
  if (cond) { pass++; log.push('PASS  ' + name); }
  else { fail++; log.push('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const profile = path.join(os.tmpdir(), 'edge-e2e-' + Date.now());
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=390,844', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
    'http://127.0.0.1:' + PORT + '/index.html',
  ], { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 80; i++) {
    try {
      const l = JSON.parse(await get('/json')).filter(x => x.type === 'page' && x.webSocketDebuggerUrl && x.url.indexOf('index.html') >= 0);
      if (l.length) { t = l[0]; break; }
    } catch (e) { }
    await wait(250);
  }
  if (!t) { console.log('no target'); process.exit(1); }

  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  await send('Runtime.enable');
  await wait(2200);

  // ---- 数据层 ----
  ok('DB 已加载(不是卡在 ready)', await ev("DB.health.loaded") === true);
  ok('走 IndexedDB', await ev("DB.health.engine") === 'IndexedDB');
  ok('flush 可等待', await ev("DB.flush().then(()=>'ok')") === 'ok');

  await ev(SEED);
  await ev("DB.flush()");
  await ev("location.reload()");
  await wait(2600);

  ok('重载后 3 本书', await ev("document.querySelectorAll('.book-card').length") === 3);

  // ---- 继续写作 ----
  ok('继续写作卡片可见', await ev("!document.getElementById('resume-card').classList.contains('hidden')"));
  const rcText = await ev("document.getElementById('resume-card').textContent");
  ok('继续写作指向最近章节', /中段|开头/.test(rcText || ''), rcText);
  ok('继续写作带书名', /《测试书/.test(rcText || ''), rcText);

  // ---- 封面防撞色 ----
  const covers = await ev("JSON.stringify([...document.querySelectorAll('.book-cover')].map(e=>getComputedStyle(e).backgroundImage))");
  const arr = JSON.parse(covers || '[]');
  ok('3 本书封面都有底色', arr.length === 3 && arr.every(s => s && s !== 'none'), arr);
  ok('3 本书封面互不同色', new Set(arr).size === 3, arr);

  // ---- 搜索 ----
  await ev("document.querySelector('#btn-search').click()");
  await wait(300);
  ok('搜索栏展开', await ev("!document.getElementById('search-wrap').classList.contains('hidden')"));
  await ev("(function(){const i=document.getElementById('search-input');i.value='青石';i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await wait(400);
  const hits = await ev("document.querySelectorAll('.sr-hit').length");
  ok('正文关键词能搜到章节', hits === 6, hits);
  const hitText = await ev("document.querySelector('.sr-hit').textContent");
  ok('搜索结果带书名', /《测试书/.test(hitText || ''), hitText);
  ok('搜索结果高亮命中词', await ev("!!document.querySelector('.sr-hit .sh-s em')"));

  // 搜书名
  await ev("(function(){const i=document.getElementById('search-input');i.value='乙';i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await wait(400);
  const hits2 = await ev("JSON.stringify([...document.querySelectorAll('.sr-hit .sh-t')].map(e=>e.textContent))");
  ok('书名能被搜到', /测试书乙/.test(hits2 || ''), hits2);

  // 搜不到
  await ev("(function(){const i=document.getElementById('search-input');i.value='不存在的词xyz';i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await wait(400);
  ok('搜不到时给空状态', await ev("!!document.querySelector('.search-empty')"));

  await ev("document.querySelector('#search-cancel').click()");
  await wait(300);
  ok('取消后书架回来', await ev("!document.getElementById('book-grid').classList.contains('hidden')"));
  ok('取消后继续写作卡片回来', await ev("!document.getElementById('resume-card').classList.contains('hidden')"));

  // ---- 长按不应顺带触发点击 ----
  await ev(`(function(){
    const card = document.querySelector('.book-card');
    const mk = t => card.dispatchEvent(new TouchEvent(t, { bubbles: true }));
    mk('touchstart');
    return 1;
  })()`);
  await wait(650);
  await ev(`(function(){
    const card = document.querySelector('.book-card');
    card.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
    card.click();
    return 1;
  })()`);
  await wait(400);
  ok('长按弹出书籍菜单', await ev("!document.getElementById('sheet').classList.contains('hidden')"));
  ok('长按后没有顺带进入目录', await ev("document.getElementById('view-shelf').classList.contains('active')"));
  await ev("document.querySelector('#sheet-mask').click()");
  await wait(300);

  // ---- 沉浸模式 ----
  await ev("document.querySelector('.book-card').click()");
  await wait(600);
  await ev("document.querySelector('.chap-item').click()");
  await wait(700);
  ok('进入编辑器', await ev("document.getElementById('view-editor').classList.contains('active')"));
  ok('正文默认衬线', await ev("(function(){const f=getComputedStyle(document.getElementById('ed-text')).fontFamily;return /Songti|STSong|SimSun|serif/i.test(f)?f:false})()"));
  ok('正文不是黑体', await ev("!/Microsoft YaHei|PingFang|MiSans/i.test(getComputedStyle(document.getElementById('ed-text')).fontFamily)"));

  await ev("document.querySelector('#ed-tool-reading').click()");
  await wait(400);
  ok('沉浸:顶栏隐藏', await ev("getComputedStyle(document.querySelector('.editor-top')).display") === 'none');
  ok('沉浸:底栏隐藏', await ev("getComputedStyle(document.querySelector('.ed-footer')).display") === 'none');
  ok('沉浸:退出按钮出现', await ev("!document.getElementById('btn-exit-immersive').classList.contains('hidden')"));
  await ev("document.querySelector('#btn-exit-immersive').click()");
  await wait(400);
  ok('点退出能回来', await ev("getComputedStyle(document.querySelector('.editor-top')).display") !== 'none');
  ok('退出后按钮隐藏', await ev("document.getElementById('btn-exit-immersive').classList.contains('hidden')"));

  // ---- 统计去重 ----
  await ev("document.querySelector('#ed-back') && 0");
  await ev("document.querySelector('#btn-ed-back').click()");
  await wait(400);
  await ev("document.querySelector('#btn-cat-back').click()");
  await wait(400);
  await ev("document.querySelector('#btn-stats').click()");
  await wait(700);
  const dupCount = await ev("DB.stats().filter(s=>s.date==='2026-01-02').length");
  ok('同一天的统计被合并成 1 条', dupCount === 1, dupCount);
  const merged = await ev("JSON.stringify(DB.stats().find(s=>s.date==='2026-01-02'))");
  ok('合并后字数相加 = 350', /350/.test(merged || ''), merged);
  ok('统计页渲染出图表', await ev("!!document.getElementById('stat-chart')"));

  // ---- 数据持久化 ----
  const before = await ev("DB.all('article').length");
  await ev("DB.flush()");
  await ev("location.reload()");
  await wait(2600);
  const after = await ev("DB.all('article').length");
  ok('重载后章节数不变', before === after && before === 6, { before, after });

  // ---- 写作辅助:大纲 / 角色 / 灵感 ----
  await ev("document.querySelector('.book-card').click()");
  await wait(500);
  await ev("document.querySelector('#btn-cat-more').click()");
  await wait(400);
  ok('书籍菜单有作品大纲', await ev("!!document.querySelector('#sheet-body [data-act=outline]')"));
  ok('书籍菜单有角色设定', await ev("!!document.querySelector('#sheet-body [data-act=char]')"));
  ok('书籍菜单有灵感记录', await ev("!!document.querySelector('#sheet-body [data-act=idea]')"));

  await ev("document.querySelector('#sheet-body [data-act=outline]').click()");
  await wait(500);
  ok('打开大纲页', await ev("document.getElementById('view-notes').classList.contains('active')"));
  ok('大纲页显示书名', /《测试书/.test(await ev("document.getElementById('notes-book').textContent") || ''));

  await ev("(function(){document.getElementById('outline-text').value='一、开局\\n二、转折';document.getElementById('outline-save').click();return 1})()");
  await wait(300);
  ok('大纲保存成功', await ev("DB.outline(DB.books()[0].id).text") === '一、开局\n二、转折');

  await ev("document.querySelector('[data-kind=char]').click()");
  await wait(400);
  ok('大纲 tab 隐藏新建按钮', await ev("document.getElementById('btn-notes-add').classList.contains('hidden')") === false);

  await ev("document.querySelector('#btn-notes-add').click()");
  await wait(400);
  await ev("(function(){document.getElementById('note-title').value='沈青';document.getElementById('note-text').value='主角';document.getElementById('note-save').click();return 1})()");
  await wait(400);
  ok('新增角色后出现卡片', await ev("document.querySelectorAll('.note-card').length") === 1);
  ok('角色卡片显示名字', /沈青/.test(await ev("document.querySelector('.nc-title').textContent") || ''));

  await ev("document.querySelector('[data-kind=idea]').click()");
  await wait(400);
  ok('切到灵感是空状态', await ev("!!document.querySelector('.notes-scroll .empty')"));

  await ev("document.querySelector('#btn-notes-back').click()");
  await wait(500);
  ok('从大纲页返回目录', await ev("document.getElementById('view-catalog').classList.contains('active')"));

  // ---- 智能排版(走 UI) ----
  await ev("document.querySelector('.chap-item').click()");
  await wait(700);
  await ev("(function(){const t=document.getElementById('ed-text');t.value='他来了,然后走了。\\n\\n\\n\\n第二段   ';return 1})()");
  await ev("document.querySelector('#ed-tool-type').click()");
  await wait(500);
  ok('排版面板有全部整理', await ev("!!document.querySelector('[data-fmt=all]')"));
  await ev("document.querySelector('[data-fmt=all]').click()");
  await wait(2200);   // 等自动保存(1.5s 防抖)真正落库
  const fmted = await ev("document.getElementById('ed-text').value");
  ok('智能排版:空行收成一个', fmted.indexOf('\n\n\n') < 0, fmted);
  ok('智能排版:首行缩进', fmted.indexOf('\u3000\u3000他来了') === 0, JSON.stringify(fmted));
  ok('智能排版:中文逗号转全角', /，/.test(fmted), fmted);
  ok('智能排版:行尾空格清掉', !/ {2,}$/m.test(fmted), JSON.stringify(fmted));
  const histN = await ev("(function(){const a=DB.all('article').find(a=>a.text&&a.text.indexOf('第二段')>=0);return a?DB.history(a.id).length:-1})()");
  ok('排版前原文进了历史', histN >= 1, histN);

  // ---- 目录正序/倒序 ----
  await ev("document.querySelector('#btn-ed-back').click()");
  await wait(500);
  const names0 = await ev("JSON.stringify([...document.querySelectorAll('.chap-name')].map(e=>e.textContent))");
  await ev("document.querySelector('#btn-cat-sort').click()");
  await wait(500);
  const names1 = await ev("JSON.stringify([...document.querySelectorAll('.chap-name')].map(e=>e.textContent))");
  ok('切换倒序后顺序真的反了', JSON.stringify(JSON.parse(names0).slice().reverse()) === names1, { names0, names1 });
  await ev("document.querySelector('#btn-cat-sort').click()");
  await wait(400);
  const names2 = await ev("JSON.stringify([...document.querySelectorAll('.chap-name')].map(e=>e.textContent))");
  ok('再切回正序恢复原样', names0 === names2, { names0, names2 });

  try { edge.kill(); } catch (e) { }
  server.close();

  console.log(`pass=${pass} fail=${fail}\n`);
  console.log(log.join('\n'));
  if (fail) process.exitCode = 1;
})();

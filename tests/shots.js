/* 多屏截图:一次会话里灌数据 → 依次导航 → 逐屏截图,用于视觉审查。
 * 用法: node tests/shots.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', 'www');
const OUT = path.join(__dirname, '..', 'shots');
const PORT = 8793;
const CDP = 9233;
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

let ws, msgId = 0;
const pending = new Map();
const send = (method, params) => new Promise(res => {
  const id = ++msgId;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params: params || {} }));
});

async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const d = r.result;
  if (d.exceptionDetails) return 'EXCEPTION: ' + ((d.exceptionDetails.exception && d.exceptionDetails.exception.description) || d.text);
  return d.result ? d.result.value : undefined;
}

async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (s.result && s.result.data) {
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64'));
    console.log('  shot ' + name);
  } else console.log('  shot FAILED ' + name);
}

const SEED = `
(function(){
  const DB = window.DB;
  // 清空,保证可重复
  ['book','article','volume','group','stat','history','recycle'].forEach(t => DB.save(t, []));
  const now = Date.now();
  const names = ['长夜将明', '山海拾遗录', '第七次搬家'];
  const chTitles = ['楔子', '雨夜来客', '旧照片', '她说的那句话', '第二封信', '天亮之前'];
  const body = '雨下了整夜,屋檐的水声一下一下敲在铁皮上。\\n\\n我坐在桌前,把那张旧照片翻过来又翻过去,背面有一行褪色的钢笔字,已经认不清了。\\n\\n门被敲响的时候,我以为是风。\\n\\n"是我。"门外的人说。\\n\\n我认得这个声音。三年前的那个下午,她就是用这个声音跟我说,她要走了。';
  names.forEach((n, bi) => {
    const b = DB.addBook(n);
    DB.put('book', { id: b.id, createTime: now - bi * 86400000 * 3, updateTime: now - bi * 3600000 });
    const cnt = bi === 0 ? 6 : (bi === 1 ? 4 : 2);
    for (let i = 0; i < cnt; i++) {
      const a = DB.addArticle(b.id, '', chTitles[i]);
      DB.saveArticle(a.id, body.repeat(1 + (i % 3)));
      DB.put('article', { id: a.id, updateTime: now - (cnt - i) * 600000 });
    }
  });
  // 造点统计
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const p = x => String(x).padStart(2, '0');
    DB.put('stat', { id: 's' + i, date: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
      wordsTxtInput: 500 + Math.round(Math.random() * 3500), wordsAllInput: 0,
      wordsTxtTotal: 12000, wordsAllTotal: 12000, writeDuration: 1800, idleDuration: 0,
      createTime: Date.now(), updateTime: Date.now() });
  }
  return DB.books().length;
})()
`;

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const profile = path.join(os.tmpdir(), 'edge-shots-' + Date.now());
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=2', '--force-prefers-reduced-motion',
    '--window-size=390,844', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
    'http://127.0.0.1:' + PORT + '/index.html',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = JSON.parse(await get('/json')).filter(t => t.type === 'page' && t.webSocketDebuggerUrl && String(t.url).indexOf('index.html') >= 0);
      if (list.length) { target = list[0]; break; }
    } catch (e) { }
    await new Promise(r => setTimeout(r, 250));
  }
  if (!target) { console.log('no target'); edge.kill(); server.close(); process.exit(1); }

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  const logs = [];
  await send('Runtime.enable');
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') logs.push('[' + m.params.type + '] ' + m.params.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' '));
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; logs.push('[EXC] ' + ((d.exception && d.exception.description) || d.text)); }
  });

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await new Promise(r => setTimeout(r, 2200));

  console.log('seed =>', await ev(SEED));
  // 等 IndexedDB 事务真正提交,再重载(否则写入会被 reload 冲掉)
  console.log('flush =>', await ev("DB.flush().then(()=>'ok')"));
  // 灌完数据后重载,让 boot() 走正常的渲染路径
  await ev("location.reload()");
  await new Promise(r => setTimeout(r, 2600));
  console.log('after reload books =>', await ev("document.querySelectorAll('.book-card').length"));
  await shot('01-shelf');

  await ev("document.querySelector('.book-card').click()");
  await new Promise(r => setTimeout(r, 700));
  await shot('02-catalog');

  await ev("document.querySelector('.chap-item').click()");
  await new Promise(r => setTimeout(r, 900));
  await shot('03-editor');

  await ev("document.querySelector('#btn-ed-more').click()");
  await new Promise(r => setTimeout(r, 700));
  await shot('04-editor-more');
  await ev("UI.closeSheet()");

  await ev("document.querySelector('#btn-ed-back').click()");
  await new Promise(r => setTimeout(r, 500));
  await ev("document.querySelector('#btn-cat-back').click()");
  await new Promise(r => setTimeout(r, 500));

  await ev("document.querySelector('#btn-stats').click()");
  await new Promise(r => setTimeout(r, 900));
  await shot('05-stats');
  await ev("document.querySelector('#btn-stats-back').click()");
  await new Promise(r => setTimeout(r, 500));

  await ev("document.querySelector('#btn-settings').click()");
  await new Promise(r => setTimeout(r, 700));
  await shot('06-settings');
  await ev("document.querySelector('#btn-set-back').click()");
  await new Promise(r => setTimeout(r, 500));

  await ev("document.querySelector('#btn-tools').click()");
  await new Promise(r => setTimeout(r, 700));
  await shot('07-tools');
  await ev("UI.closeSheet()");
  await new Promise(r => setTimeout(r, 400));

  // 搜索
  await ev("document.querySelector('#btn-search').click()");
  await new Promise(r => setTimeout(r, 400));
  await ev("(function(){const i=document.querySelector('#search-input');i.value='雨';i.dispatchEvent(new Event('input',{bubbles:true}));return document.querySelectorAll('.sr-hit').length})()");
  await new Promise(r => setTimeout(r, 500));
  await shot('08-search');
  await ev("document.querySelector('#search-cancel').click()");
  await new Promise(r => setTimeout(r, 400));

  // 沉浸模式
  await ev("document.querySelector('.book-card').click()");
  await new Promise(r => setTimeout(r, 600));
  await ev("document.querySelector('.chap-item').click()");
  await new Promise(r => setTimeout(r, 800));
  await ev("document.querySelector('#ed-tool-reading').click()");
  await new Promise(r => setTimeout(r, 700));
  await shot('09-immersive');

  if (logs.length) { console.log('--- console ---'); logs.slice(0, 20).forEach(l => console.log('  ' + l)); }

  try { edge.kill(); } catch (e) { }
  server.close();
  process.exit(0);
})();

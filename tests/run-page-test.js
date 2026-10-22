/* 通用自检跑批:起静态服务(项目根) + headless Edge + CDP 轮询 #out。
 * 不用 --virtual-time-budget:虚拟时间不会推进 IndexedDB 的真实异步回调。
 * 用法: node tests/run-page-test.js tests/selftest.html
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PAGE = process.argv[2] || 'tests/selftest.html';
const PORT = 8795 + Math.floor(Math.random() * 40);
const CDP = 9251 + Math.floor(Math.random() * 40);
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

const get = path_ => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP, path: path_ }, r => {
    let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res(b));
  }).on('error', rej);
});

async function evalInPage(expr) {
  let targets = null;
  const match = path.basename(PAGE);
  for (let i = 0; i < 80; i++) {
    try {
      const list = JSON.parse(await get('/json')).filter(t =>
        t.type === 'page' && t.webSocketDebuggerUrl && String(t.url).indexOf(match) >= 0);
      if (list.length) { targets = list; break; }
    } catch (e) { }
    await new Promise(r => setTimeout(r, 250));
  }
  if (!targets) throw new Error('no CDP target');
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const r = await new Promise(res => {
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id === 1) res(m); };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });
  ws.close();
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    return 'EXCEPTION: ' + ((d.exception && d.exception.description) || d.text);
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const profile = path.join(os.tmpdir(), 'edge-pt-' + Date.now());
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + CDP,
    '--user-data-dir=' + profile,
    'http://127.0.0.1:' + PORT + '/' + PAGE,
  ], { stdio: 'ignore' });

  let out = null;
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const t = await evalInPage("(document.getElementById('out')||{}).textContent || 'pending'");
      if (t && String(t).indexOf('EXCEPTION') !== 0 && t !== 'pending') { out = t; break; }
    } catch (e) { }
  }

  try { edge.kill(); } catch (e) { }
  server.close();

  if (out === null) { console.log('TIMEOUT: ' + PAGE + ' 始终 pending'); process.exitCode = 1; return; }
  console.log('=== ' + PAGE + ' ===');
  console.log(out);
  if (/fail=[1-9]/.test(out) || /CRASH/.test(out)) process.exitCode = 1;
})();

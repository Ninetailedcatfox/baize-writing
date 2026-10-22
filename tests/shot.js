/* 通用无头浏览器工具:起静态服务 + headless Edge + CDP
 * 用法:
 *   node tests/shot.js <页面> <输出png> [宽] [高] [等待ms] [表达式...]
 * 例:
 *   node tests/shot.js index.html out.png 390 844 2500
 *   node tests/shot.js index.html out.png 390 844 2500 "DB.health" "document.querySelectorAll('.book-card').length"
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', 'www');
const PORT = 8792;
const CDP = 9232;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

const page = process.argv[2] || 'index.html';
const outPng = process.argv[3] || 'shot.png';
const W = +(process.argv[4] || 390);
const H = +(process.argv[5] || 844);
const WAIT = +(process.argv[6] || 2500);
const exprs = process.argv.slice(7);

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
function send(method, params) {
  return new Promise(res => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const profile = path.join(os.tmpdir(), 'edge-shot-' + Date.now());
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=2',
    '--window-size=' + W + ',' + H,
    '--remote-debugging-port=' + CDP,
    '--user-data-dir=' + profile,
    'http://127.0.0.1:' + PORT + '/' + page,
  ], { stdio: 'ignore' });

  // 等目标出现
  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = JSON.parse(await get('/json')).filter(t =>
        t.type === 'page' && t.webSocketDebuggerUrl && String(t.url).indexOf(page) >= 0);
      if (list.length) { target = list[0]; break; }
    } catch (e) { }
    await new Promise(r => setTimeout(r, 250));
  }
  if (!target) { console.log('ERROR: no target'); try { edge.kill(); } catch (e) { } server.close(); process.exit(1); }

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  // 抓页面 console 与异常
  const logs = [];
  await send('Runtime.enable');
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push('[' + m.params.type + '] ' + m.params.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push('[EXCEPTION] ' + ((d.exception && d.exception.description) || d.text));
    }
  });

  await new Promise(r => setTimeout(r, WAIT));

  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });

  if (exprs.length) {
    for (const e of exprs) {
      if (e.indexOf('wait:') === 0) { await new Promise(r => setTimeout(r, +e.slice(5) || 500)); continue; }
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      const d = r.result;
      let v;
      if (d.exceptionDetails) v = 'EXCEPTION: ' + ((d.exceptionDetails.exception && d.exceptionDetails.exception.description) || d.exceptionDetails.text);
      else v = JSON.stringify(d.result ? d.result.value : undefined);
      console.log('  ' + e + '  =>  ' + v);
    }
  }

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(path.resolve(__dirname, '..', outPng), Buffer.from(shot.result.data, 'base64'));
    console.log('screenshot -> ' + outPng);
  } else {
    console.log('screenshot FAILED');
  }

  if (logs.length) { console.log('--- console ---'); logs.slice(0, 30).forEach(l => console.log('  ' + l)); }

  try { edge.kill(); } catch (e) { }
  server.close();
  process.exit(0);
})();

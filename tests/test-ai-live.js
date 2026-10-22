/* AI 真实网络路径集成测试:起一个假的 OpenAI 兼容服务,验证
 *  - 请求打到 {base}/chat/completions
 *  - Authorization: Bearer <key>
 *  - 请求体(model / messages / temperature / max_tokens)
 *  - 返回解析 + clean() 清洗
 *  - 4xx 错误转成人话
 * 用法: node tests/test-ai-live.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', 'www');
const WEB_PORT = 8841;
const MOCK_PORT = 8842;
const CDP = 9241;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

/* ---------- 假模型服务 ---------- */
let captured = null;   // { path, headers, body }
let mode = 'ok';       // ok | badkey | html

const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', d => { raw += d; });
  req.on('end', () => {
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { }
    captured = { path: req.url, headers: req.headers, body: parsed, raw };

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

    if (mode === 'badkey') {
      res.writeHead(401, Object.assign({ 'Content-Type': 'application/json' }, cors));
      res.end(JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } }));
      return;
    }
    if (mode === 'html') {
      res.writeHead(502, Object.assign({ 'Content-Type': 'text/html' }, cors));
      res.end('<html><body><h1>502 Bad Gateway</h1></body></html>');
      return;
    }

    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
    res.end(JSON.stringify({
      id: 'chatcmpl-mock',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: '```\n好的,以下是扩写内容:\n她把橘子一颗颗捡回来,指尖沾着凉水。\n```',
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    }));
  });
});

/* ---------- 静态服务 ---------- */
const web = http.createServer((req, res) => {
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

(async () => {
  await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));
  await new Promise(r => web.listen(WEB_PORT, '127.0.0.1', r));

  const profile = path.join(os.tmpdir(), 'edge-ailive-' + Date.now());
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
    'http://127.0.0.1:' + WEB_PORT + '/index.html',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const list = JSON.parse(await get('/json')).filter(t => t.type === 'page' && t.webSocketDebuggerUrl && String(t.url).indexOf('index.html') >= 0);
      if (list.length) { target = list[0]; break; }
    } catch (e) { }
    await wait(250);
  }
  if (!target) { console.log('no target'); try { edge.kill(); } catch (e) { } process.exit(1); }

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };

  const log = [];
  let pass = 0, fail = 0;
  const ok = (name, cond, extra) => {
    if (cond) { pass++; log.push('PASS  ' + name); }
    else { fail++; log.push('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
  };

  // 等 App 起来
  for (let i = 0; i < 40; i++) {
    if (await ev("!!(window.DB && window.AI && window.DB.ready)")) break;
    await wait(300);
  }
  await ev("DB.ready");
  ok('App 已启动且 AI 模块就位', await ev("!!(window.AI && window.AI.generate)") === true);

  await ev(`(function(){
    DB.setSetting('aiBaseUrl','http://127.0.0.1:${MOCK_PORT}/v1');
    DB.setSetting('aiKey','sk-mock-key');
    DB.setSetting('aiModel','mock-model');
    DB.setSetting('aiTemp', 0.6);
    return 1;
  })()`);

  /* ---------- 1. 正常生成 ---------- */
  mode = 'ok';
  captured = null;
  const out = await ev(`(async function(){
    try {
      const t = await window.AI.generate({
        bookName:'归墟', chapterName:'第一章',
        outline:'女主被退婚,独自去海边。',
        chars:[{title:'林晚',text:'二十七岁,做瓷器修复。'}],
        before:'她把最后一颗橘子丢进垃圾桶。',
        instruction:'她把水果都扔了', length:200, mode:'expand'
      });
      return JSON.stringify({ ok:true, text:t });
    } catch (e) { return JSON.stringify({ ok:false, err:String(e && e.message || e) }); }
  })()`);
  let r1 = null;
  try { r1 = JSON.parse(out); } catch (e) { }
  ok('生成不报错', r1 && r1.ok === true, out);
  ok('拿回正文', r1 && /她把橘子一颗颗捡回来/.test(r1.text || ''), r1 && r1.text);
  ok('去掉了 ``` 围栏', r1 && (r1.text || '').indexOf('```') < 0, r1 && r1.text);
  ok('去掉了"好的,以下是"开场', r1 && (r1.text || '').indexOf('好的') < 0, r1 && r1.text);

  ok('请求打到 /v1/chat/completions', captured && captured.path === '/v1/chat/completions', captured && captured.path);
  ok('带 Bearer 鉴权头',
     captured && captured.headers.authorization === 'Bearer sk-mock-key',
     captured && captured.headers.authorization);
  ok('请求体带模型名', captured && captured.body && captured.body.model === 'mock-model', captured && captured.body && captured.body.model);
  ok('请求体带 temperature', captured && captured.body && captured.body.temperature === 0.6, captured && captured.body && captured.body.temperature);
  ok('请求体带 max_tokens', captured && captured.body && captured.body.max_tokens === 1600, captured && captured.body && captured.body.max_tokens);
  ok('请求体是两条消息(system+user)',
     captured && captured.body && Array.isArray(captured.body.messages) && captured.body.messages.length === 2,
     captured && captured.body && captured.body.messages && captured.body.messages.length);
  const userMsg = captured && captured.body && captured.body.messages && captured.body.messages[1] && captured.body.messages[1].content || '';
  ok('上下文喂到了服务端(书名)', userMsg.indexOf('《归墟》') >= 0, userMsg.slice(0, 40));
  ok('上下文喂到了服务端(用户那句话)', userMsg.indexOf('她把水果都扔了') >= 0);
  ok('上下文喂到了服务端(上文)', userMsg.indexOf('最后一颗橘子') >= 0);
  ok('上下文喂到了服务端(角色)', userMsg.indexOf('林晚') >= 0);
  ok('浏览器兜底强制非流式', captured && captured.body && captured.body.stream === false, captured && captured.body && captured.body.stream);

  /* ---------- 2. Key 错 ---------- */
  mode = 'badkey';
  const out2 = await ev(`(async function(){
    try { await window.AI.generate({bookName:'x',instruction:'y',mode:'expand'}); return JSON.stringify({ok:true}); }
    catch(e){ return JSON.stringify({ok:false, err:String(e && e.message || e)}); }
  })()`);
  let r2 = null;
  try { r2 = JSON.parse(out2); } catch (e) { }
  ok('Key 错时抛错', r2 && r2.ok === false, out2);
  ok('错误里带状态码 401', r2 && /401/.test(r2.err || ''), r2 && r2.err);
  ok('错误里带服务端原话', r2 && /Incorrect API key/.test(r2.err || ''), r2 && r2.err);

  /* ---------- 3. 服务端返回 HTML 错误页 ---------- */
  mode = 'html';
  const out3 = await ev(`(async function(){
    try { await window.AI.generate({bookName:'x',instruction:'y',mode:'expand'}); return JSON.stringify({ok:true}); }
    catch(e){ return JSON.stringify({ok:false, err:String(e && e.message || e)}); }
  })()`);
  let r3 = null;
  try { r3 = JSON.parse(out3); } catch (e) { }
  ok('502 也能抛错', r3 && r3.ok === false, out3);
  ok('错误信息不甩整页 HTML', r3 && (r3.err || '').length < 300, r3 && (r3.err || '').length);

  /* ---------- 4. 没填 Key 时不发请求 ---------- */
  await ev("DB.setSetting('aiKey','')");
  captured = null;
  const out4 = await ev(`(async function(){
    try { await window.AI.generate({bookName:'x',instruction:'y',mode:'expand'}); return JSON.stringify({ok:true}); }
    catch(e){ return JSON.stringify({ok:false, err:String(e && e.message || e)}); }
  })()`);
  let r4 = null;
  try { r4 = JSON.parse(out4); } catch (e) { }
  ok('没 Key 时抛错', r4 && r4.ok === false, out4);
  ok('没 Key 时提示去设置', r4 && /API Key/.test(r4.err || ''), r4 && r4.err);
  ok('没 Key 时根本没发请求', captured === null, captured && captured.path);

  try { edge.kill(); } catch (e) { }
  mock.close(); web.close();

  console.log(`pass=${pass} fail=${fail}\n`);
  console.log(log.join('\n'));
  if (fail) process.exitCode = 1;
})();

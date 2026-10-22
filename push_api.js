/* 兜底推送:git 的 CONNECT 隧道被代理挡掉时,改走 api.github.com 的 Git Data API。
 * api.github.com 一直是通的,只有 github.com/.../info/refs 会 502。
 *
 * 一次提交(不是一文件一提交),避免触发多次构建。
 * 用法: node push_api.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = 'Ninetailedcatfox/baize-writing';
const BRANCH = 'main';

function gh(args, input) {
  const opts = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  if (input !== undefined) { opts.input = input; }
  return execFileSync('gh', args, opts);
}
function api(method, p, body) {
  const args = ['api', '-X', method, p];
  if (body !== undefined) { args.push('--input', '-'); }
  const out = gh(args, body === undefined ? undefined : JSON.stringify(body));
  return out ? JSON.parse(out) : null;
}

/* 本次改动的文件(相对项目根) */
const FILES = [
  'android/app/build.gradle',
  'package.json',
  'ship.py',
  'make_qr_card.py',
  'tests/e2e.js',
  'www/css/style.css',
  'www/js/ui.js',
  'www/js/update.js',
];

const HERE = __dirname;
const msg = process.argv[2] || 'style(v2.6.1): 书封改成近白纸底 + 彩色书脊,整页不再发闷';

// 1) 当前分支指向的 commit
const ref = api('GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`);
const headSha = ref.object.sha;
const headCommit = api('GET', `/repos/${REPO}/git/commits/${headSha}`);
const baseTree = headCommit.tree.sha;
console.log('head', headSha.slice(0, 7), 'tree', baseTree.slice(0, 7));

// 2) 逐个文件建 blob
const tree = [];
for (const f of FILES) {
  const abs = path.join(HERE, f);
  if (!fs.existsSync(abs)) { console.log('skip (missing)', f); continue; }
  const content = fs.readFileSync(abs).toString('base64');
  const blob = api('POST', `/repos/${REPO}/git/blobs`, { content, encoding: 'base64' });
  tree.push({ path: f, mode: '100644', type: 'blob', sha: blob.sha });
  console.log('blob', blob.sha.slice(0, 7), f);
}

// 3) 建 tree
const newTree = api('POST', `/repos/${REPO}/git/trees`, { base_tree: baseTree, tree });
console.log('tree', newTree.sha.slice(0, 7));

// 4) 建 commit
const newCommit = api('POST', `/repos/${REPO}/git/commits`, {
  message: msg,
  tree: newTree.sha,
  parents: [headSha],
});
console.log('commit', newCommit.sha.slice(0, 7));

// 5) 移动分支
api('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: newCommit.sha, force: false });
console.log('ref updated ->', newCommit.sha.slice(0, 7));

// 让本地也跟上,避免下次 git push 因为分叉失败
try {
  execFileSync('git', ['fetch', 'origin', BRANCH], { cwd: HERE, stdio: 'ignore' });
  execFileSync('git', ['reset', '--soft', `origin/${BRANCH}`], { cwd: HERE, stdio: 'ignore' });
  console.log('本地已同步到远端');
} catch (e) {
  console.log('本地同步失败(不影响远端):', e.message);
}

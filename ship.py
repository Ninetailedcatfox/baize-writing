# -*- coding: utf-8 -*-
"""一键发布白泽写作 APK:取云端构建产物 -> 传资料库 -> 生成下载二维码。

用法:
    python ship.py                 # 用最近一次成功的构建
    python ship.py <run_id>        # 指定 GitHub Actions run id

产物:
    apk_url_v<ver>.txt      资料库签名直链
    download-card-v<ver>.png 下载卡片(已复制到工作区根)
    refresh_qr.py 的 NODES 自动加一条
"""
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LIB = r"C:/Program Files/WorkBuddyAI/resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/library"
PY = sys.executable
DL = os.path.join(HERE, "dl")

VERSION = "2.5.0"
CODE = 7


def run(args, cwd=None, quiet=False):
    r = subprocess.run(args, cwd=cwd, capture_output=True)
    out = r.stdout.decode("utf-8", "replace") + r.stderr.decode("utf-8", "replace")
    if r.returncode != 0 and not quiet:
        print(out[-1500:])
    return r.returncode, out


def latest_run():
    rc, out = run(["gh", "run", "list", "--workflow", "Build APK",
                   "--status", "success", "--limit", "1", "--json", "databaseId,headSha,displayTitle"], cwd=HERE)
    data = json.loads(out[out.index("["):out.rindex("]") + 1])
    if not data:
        raise SystemExit("找不到成功的构建")
    return data[0]["databaseId"], data[0]["displayTitle"]


def download(run_id):
    if os.path.isdir(DL):
        shutil.rmtree(DL)
    rc, out = run(["gh", "run", "download", str(run_id), "-n", "baize-writing-apk", "-D", DL], cwd=HERE)
    if rc != 0:
        raise SystemExit("下载构建产物失败")
    apks = []
    for base, _, files in os.walk(DL):
        for f in files:
            if f.endswith(".apk"):
                apks.append(os.path.join(base, f))
    if not apks:
        raise SystemExit("产物里没有 apk")
    # 只分发 debug 包:release 是未签名的,装不上
    debug = [p for p in apks if "debug" in p.lower()]
    pick = debug[0] if debug else apks[0]
    print("[1/4] 产物: %s  (%.2f MB)" % (os.path.basename(pick), os.path.getsize(pick) / 1048576.0))
    return pick


def upload(apk):
    name = "baize-writing-v%s.apk" % VERSION
    rc, out = run([PY, os.path.join(LIB, "drive/upload_drive_file.py"), apk, "--file-name", name], cwd=LIB)
    m = re.search(r'"node_block_id"\s*:\s*"([^"]+)"', out)
    if not m:
        m = re.search(r'"node_id"\s*:\s*"([^"]+)"', out)
    if not m:
        print(out[-2000:])
        raise SystemExit("上传失败:拿不到 node_id")
    print("[2/4] 资料库节点: %s" % m.group(1))
    return m.group(1)


def patch_nodes(node_id, tag):
    p = os.path.join(HERE, "refresh_qr.py")
    src = open(p, encoding="utf-8").read()
    entry = ('    "%s": ("%s", "白泽写作v%s下载二维码.png", "apk_url_v%s.txt", "download-card-v%s.png", "白泽写作 v%s"),\n'
             % (tag, node_id, VERSION, tag, tag, VERSION))
    if '"%s":' % tag in src:
        src = re.sub(r'    "%s": \(.*?\),\n' % tag, entry, src, count=1)
    else:
        src = src.replace('NODES = {\n', 'NODES = {\n' + entry, 1)
    open(p, "w", encoding="utf-8").write(src)
    print("[3/4] refresh_qr.py 已加 NODES['%s']" % tag)


def make_qr(tag):
    rc, out = run([PY, os.path.join(HERE, "refresh_qr.py"), tag], cwd=HERE)
    print(out.strip()[-1200:])
    if rc != 0:
        raise SystemExit("生成二维码失败")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        run_id, title = sys.argv[1], "(手动指定)"
    else:
        run_id, title = latest_run()
    tag = "v" + VERSION.replace(".", "")[:3]   # 2.5.0 -> v250
    print("构建 %s  %s" % (run_id, title))
    apk = download(run_id)
    node = upload(apk)
    patch_nodes(node, tag)
    make_qr(tag)
    print("[4/4] 完成")

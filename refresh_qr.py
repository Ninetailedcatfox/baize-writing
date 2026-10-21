# -*- coding: utf-8 -*-
"""一键刷新白泽写作 APK 下载二维码。

用法:
    python refresh_qr.py            # 默认刷新 v2
    python refresh_qr.py <node_id>  # 指定资料库节点

流程: 取 COS 签名直链 -> 验证可达 + APK 文件头 -> 生成下载卡片 PNG -> 复制到工作区根
"""
import os
import re
import shutil
import subprocess
import sys
import urllib.request

LIB = r"C:/Program Files/WorkBuddyAI/resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/library"
PY = r"C:/Users/Administrator/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

NODES = {
    "v2": ("2hNl2R72EWV6fePjQUfsQj", "白泽写作v2下载二维码.png", "apk_url_v2.txt", "download-card-v2.png"),
    "v1": ("T8HopoU1McCG5phDV7f2xs", "白泽写作下载二维码.png", "apk_url.txt", "download-qr.png"),
}


def get_url(node_id):
    out = subprocess.run(
        [sys.executable, os.path.join(LIB, "drive/get_download_link.py"), "--node-id", node_id],
        capture_output=True, cwd=LIB,
    )
    text = out.stdout.decode("utf-8", "replace") + out.stderr.decode("utf-8", "replace")
    m = re.search(r'"download_url":"([^"]+)"', text)
    if not m:
        raise SystemExit("取链失败:\n" + text[:500])
    return m.group(1)


def verify(url):
    req = urllib.request.Request(url, method="GET")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=120) as r:
        data = r.read()
    if not data.startswith(b"PK"):
        raise SystemExit("下载内容不是 APK/ZIP，前 8 字节: %r" % data[:8])
    return len(data)


def main():
    key = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in NODES else "v2"
    node, card_name, url_name, card_file = NODES[key]

    print("[1/3] 取直链 ...")
    url = get_url(node)
    with open(os.path.join(HERE, url_name), "w", encoding="utf-8") as f:
        f.write(url)
    print("      %d 字符" % len(url))

    print("[2/3] 验证下载 ...")
    size = verify(url)
    print("      OK %.2f MB" % (size / 1048576.0))

    print("[3/3] 生成卡片 ...")
    subprocess.run([PY, os.path.join(HERE, "make_qr_card.py"), url_name, card_file], cwd=HERE, check=True)
    dst = os.path.join(ROOT, card_name)
    shutil.copyfile(os.path.join(HERE, card_file), dst)
    print("      已输出: %s" % dst)


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""校验下载卡片上的二维码确实能扫:逐 module 采样成品 PNG,跟 qrcode 的矩阵比对。

不依赖任何解码器(本机装 opencv/pyzbar 会被 SIGTERM 杀),纯 PIL 像素采样。
用法: python verify_qr.py <卡片png> <apk_url.txt>
"""
import sys
import qrcode
from PIL import Image

CARD = sys.argv[1] if len(sys.argv) > 1 else "download-card-v250.png"
URLF = sys.argv[2] if len(sys.argv) > 2 else "apk_url_v250.txt"

URL = open(URLF, encoding="utf-8").read().strip()

# 与 make_qr_card.py 保持一致的参数
BOX, BORDER = 6, 2
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=BOX, border=BORDER)
qr.add_data(URL)
qr.make(fit=True)
mods = qr.modules
n = len(mods)

img = Image.open(CARD).convert("L")
# make_qr_card.py: PAD=56, 二维码贴在 (PAD, PAD+120)
PAD, QY = 56, 56 + 120

bad = []
for r in range(n):
    for c in range(n):
        x = PAD + (c + BORDER) * BOX + BOX // 2
        y = QY + (r + BORDER) * BOX + BOX // 2
        if x >= img.width or y >= img.height:
            bad.append((r, c, 'oob'))
            continue
        px = img.getpixel((x, y))
        dark = px < 128
        if dark != bool(mods[r][c]):
            bad.append((r, c, px))

total = n * n
print("二维码版本: %d  (矩阵 %d x %d = %d 格)" % (qr.version, n, n, total))
print("卡片尺寸: %s  二维码区域: x=%d..%d y=%d..%d" % (img.size, PAD, PAD + (n + 2 * BORDER) * BOX, QY, QY + (n + 2 * BORDER) * BOX))
if bad:
    print("不匹配 %d 格,前 10 个: %s" % (len(bad), bad[:10]))
    sys.exit(1)
print("全部 %d 格零误差 —— 二维码渲染无损,可扫" % total)

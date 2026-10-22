# -*- coding: utf-8 -*-
"""生成带说明文字的下载卡片（二维码 + 标题 + 有效期提示）"""
import sys
import qrcode
from PIL import Image, ImageDraw, ImageFont

URL = open(sys.argv[1] if len(sys.argv) > 1 else "apk_url_v2.txt", encoding="utf-8").read().strip()
OUT = sys.argv[2] if len(sys.argv) > 2 else "download-card-v2.png"
TITLE = sys.argv[3] if len(sys.argv) > 3 else "白泽写作"

# 二维码
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=6, border=2)
qr.add_data(URL)
qr.make(fit=True)
qrimg = qr.make_image(fill_color="#111111", back_color="#ffffff").convert("RGB")
qw, qh = qrimg.size

# 画布
PAD = 56
W = qw + PAD * 2
H = qh + PAD * 2 + 210
card = Image.new("RGB", (W, H), "#ffffff")
d = ImageDraw.Draw(card)

F_TITLE = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 52)
F_SUB = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 26)
F_TIP = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 24)
F_SMALL = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 21)


def center(text, y, font, fill):
    w = d.textbbox((0, 0), text, font=font)[2]
    d.text(((W - w) / 2, y), text, font=font, fill=fill)


# 顶部标题区
center(TITLE, PAD - 8, F_TITLE, "#111111")
center("写作辅助 · 智能排版 · 沉浸写作 · 全文搜索", PAD + 62, F_SUB, "#666666")

# 二维码
qy = PAD + 120
card.paste(qrimg, (PAD, qy))

# 底部说明
by = qy + qh + 34
center("手机扫码直接下载 APK · 4.0 MB · 免登录", by, F_TIP, "#111111")
center("链接有效期约 2 小时，过期请让 AI 刷新二维码", by + 40, F_SMALL, "#999999")

card.save(OUT, "PNG")
print("saved", OUT, card.size, "| qr version", qr.version, "| url chars", len(URL))

# -*- coding: utf-8 -*-
"""生成白泽写作 App 图标（彩色版）。

设计:翡翠渐变底 + 右上柔光 + 白色宋体「白」字 + 暖橙落款线。
输出:
  - 传统图标 ic_launcher.png / ic_launcher_round.png (48~192)
  - 自适应前景 ic_launcher_foreground.png (108dp 画布,内容收在中心 72dp 安全区)
  - drawable/ic_launcher_background.xml (自适应背景渐变)
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "android/app/src/main/res")
FONT = "C:/Windows/Fonts/STZHONGS.TTF"

G1 = (43, 169, 138)    # #2BA98A 浅翡翠
G2 = (20, 112, 92)     # #14705C 深青
WHITE = (255, 255, 255, 255)
WARM = (239, 138, 60, 255)   # #EF8A3C

DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}


def gradient(size, c1, c2, bias=(0.42, 0.58)):
    """对角线性渐变:小图算好再放大,省时且平滑。"""
    n = 64
    small = Image.new("RGB", (n, n))
    px = small.load()
    ax, ay = bias
    for y in range(n):
        for x in range(n):
            t = (x / (n - 1)) * ax + (y / (n - 1)) * ay
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return small.resize((size, size), Image.BICUBIC).convert("RGBA")


def add_glow(img, size):
    """右上角柔光,让平面渐变有层次。"""
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    r = size * 0.62
    cx, cy = size * 0.78, size * 0.16
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 58))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.09))
    return Image.alpha_composite(img, glow)


def draw_mark(img, cx, cy, unit, color, line_color):
    """「白」字 + 落款线。"""
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, int(unit * 0.80))
    box = d.textbbox((0, 0), "白", font=font)
    tw = box[2] - box[0]
    tx = cx - tw / 2 - box[0]
    ty = cy - (box[3] - box[1]) / 2 - box[1] - unit * 0.07
    d.text((tx, ty), "白", font=font, fill=color)

    lw = int(unit * 0.36)
    lh = max(2, int(unit * 0.058))
    ly = ty + box[3] + unit * 0.11
    d.rounded_rectangle([cx - lw / 2, ly, cx + lw / 2, ly + lh], radius=lh / 2, fill=line_color)


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def legacy(size, round_shape=False):
    base = add_glow(gradient(size, G1, G2), size)
    if round_shape:
        m = Image.new("L", (size, size), 0)
        ImageDraw.Draw(m).ellipse([0, 0, size - 1, size - 1], fill=255)
        unit = size * 0.68
    else:
        m = rounded_mask(size, int(size * 0.235))
        unit = size * 0.72
    draw_mark(base, size / 2, size / 2, unit, WHITE, WARM)
    base.putalpha(m)
    return base


def foreground(size):
    """透明前景,内容收在中心 72/108 安全区"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    safe = size * (72.0 / 108.0)
    draw_mark(img, size / 2, size / 2, safe * 0.60, WHITE, WARM)
    return img


BG_XML = '''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <gradient
        android:angle="315"
        android:startColor="#2BA98A"
        android:endColor="#14705C"
        android:type="linear" />
</shape>
'''

ADAPTIVE_XML = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
'''


def main():
    for name, scale in DENSITIES.items():
        folder = os.path.join(RES, "mipmap-" + name)
        os.makedirs(folder, exist_ok=True)
        s = int(48 * scale)
        legacy(s).save(os.path.join(folder, "ic_launcher.png"))
        legacy(s, round_shape=True).save(os.path.join(folder, "ic_launcher_round.png"))
        fs = int(108 * scale)
        foreground(fs).save(os.path.join(folder, "ic_launcher_foreground.png"))
        print("%-9s legacy %3d  foreground %3d" % (name, s, fs))

    drawable = os.path.join(RES, "drawable")
    os.makedirs(drawable, exist_ok=True)
    with open(os.path.join(drawable, "ic_launcher_background.xml"), "w", encoding="utf-8") as f:
        f.write(BG_XML)

    for fn in ("ic_launcher.xml", "ic_launcher_round.xml"):
        p = os.path.join(RES, "mipmap-anydpi-v26", fn)
        if os.path.exists(p):
            with open(p, "w", encoding="utf-8") as f:
                f.write(ADAPTIVE_XML)

    legacy(512).save(os.path.join(HERE, "icon-preview.png"))
    print("preview: icon-preview.png")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""生成白泽写作 App 图标。

设计:墨底 + 宋体「白」字 + 朱砂落款横线。
输出:
  - 传统图标 ic_launcher.png / ic_launcher_round.png (48~192)
  - 自适应前景 ic_launcher_foreground.png (108dp 画布,内容收在中心 72dp 安全区内)
"""
import os
from PIL import Image, ImageDraw, ImageFont

RES = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "android/app/src/main/res")
FONT = "C:/Windows/Fonts/STZHONGS.TTF"

INK = (26, 24, 21, 255)      # #1A1815
PAPER = (246, 244, 239, 255)  # #F6F4EF
BRAND = (180, 85, 63, 255)    # #B4553F

DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}


def draw_mark(img, cx, cy, unit, color, line_color):
    """在 (cx, cy) 为中心、unit 为整体尺度处画「白」+ 落款线。"""
    d = ImageDraw.Draw(img)
    fsize = int(unit * 0.80)
    font = ImageFont.truetype(FONT, fsize)
    box = d.textbbox((0, 0), "白", font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    tx = cx - tw / 2 - box[0]
    ty = cy - th / 2 - box[1] - unit * 0.06
    d.text((tx, ty), "白", font=font, fill=color)

    # 朱砂落款线
    lw = int(unit * 0.34)
    lh = max(2, int(unit * 0.052))
    ly = ty + box[3] + unit * 0.10
    lx = cx - lw / 2
    d.rounded_rectangle([lx, ly, lx + lw, ly + lh], radius=lh / 2, fill=line_color)


def legacy(size):
    """传统图标:墨色圆角方块 + 白字 + 朱线"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * 0.225)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=INK)
    draw_mark(img, size / 2, size / 2, size * 0.72, PAPER, BRAND)
    return img


def legacy_round(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([0, 0, size - 1, size - 1], fill=INK)
    draw_mark(img, size / 2, size / 2, size * 0.68, PAPER, BRAND)
    return img


def foreground(size):
    """自适应前景:透明底,内容收在中心 72/108 安全区"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    safe = size * (72.0 / 108.0)          # 安全区直径
    draw_mark(img, size / 2, size / 2, safe * 0.60, PAPER, BRAND)
    return img


def main():
    for name, scale in DENSITIES.items():
        folder = os.path.join(RES, "mipmap-" + name)
        os.makedirs(folder, exist_ok=True)

        s = int(48 * scale)
        legacy(s).save(os.path.join(folder, "ic_launcher.png"))
        legacy_round(s).save(os.path.join(folder, "ic_launcher_round.png"))

        fs = int(108 * scale)
        foreground(fs).save(os.path.join(folder, "ic_launcher_foreground.png"))
        print("%-9s legacy %3dpx  foreground %3dpx" % (name, s, fs))

    # 顺带存一张 512 的预览图,方便人工确认
    legacy(512).save(os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon-preview.png"))
    print("preview: icon-preview.png (512x512)")


if __name__ == "__main__":
    main()

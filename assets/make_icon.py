"""Generate FreeFlow icons: a cream waveform on a dark rounded square.
Outputs icon.ico (16..256), icon.png (512), tray.png / tray-rec.png (32 px),
and for macOS: icon.icns (square inset like other Mac icons) and the menu bar
images trayTemplate.png / trayLoadingTemplate.png / tray-mac-rec.png (16 px + @2x).
Run: python assets/make_icon.py
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
DARK = (26, 26, 26, 255)        # #1a1a1a
CREAM = (255, 255, 235, 255)    # #ffffeb
RED = (248, 113, 113, 255)      # #f87171
BARS = [0.28, 0.55, 0.92, 0.70, 0.40, 0.80, 0.50]  # relative heights of the waveform bars


def render(size, bg=DARK, fg=CREAM, dot=None, rounded=True):
    s = size * 4  # supersample for smooth edges
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=bg)
    n = len(BARS)
    pad = s * (0.18 if bg is not None else 0.06)    # menu bar glyphs use the whole square
    inner = s - 2 * pad
    gap = inner / (n * 2 - 1)
    bar_w = gap
    cy = s / 2
    for i, h in enumerate(BARS):
        x0 = pad + i * 2 * gap
        bh = inner * 0.9 * h
        d.rounded_rectangle((x0, cy - bh / 2, x0 + bar_w, cy + bh / 2), radius=int(bar_w / 2), fill=fg)
    if dot:
        r = s * 0.13
        d.ellipse((s - pad * 0.55 - 2 * r, pad * 0.55, s - pad * 0.55, pad * 0.55 + 2 * r), fill=dot)
    return im.resize((size, size), Image.LANCZOS)


def main():
    big = render(512)
    big.save(os.path.join(HERE, "icon.png"))
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [render(sz) for sz in sizes]
    frames[-1].save(os.path.join(HERE, "icon.ico"), format="ICO", sizes=[(sz, sz) for sz in sizes],
                    append_images=frames[:-1])
    render(32).save(os.path.join(HERE, "tray.png"))
    render(32, dot=RED).save(os.path.join(HERE, "tray-rec.png"))
    render(32, bg=(113, 113, 110, 255)).save(os.path.join(HERE, "tray-loading.png"))
    # Overlay "pill" logo: cream bars without background, for the renderer.
    render(64, rounded=False).save(os.path.join(HERE, "wave.png"))
    mac()
    print("icons written to", HERE)


def installer():
    """Windows installer art (24-bit BMP, NSIS sizes): the left banner of the welcome and
    finish pages (164x314) and the header of the other pages (150x57)."""
    from PIL import ImageFont
    out = os.path.join(os.path.dirname(HERE), "installer")
    bold = lambda size: ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", size)
    regular = lambda size: ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", size)
    k = 3  # supersampling
    w, h = 164 * k, 314 * k
    side = Image.new("RGB", (w, h), (26, 26, 26))
    d = ImageDraw.Draw(side)
    for y in range(h):  # dark top -> plum bottom
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(26 + 30 * t), int(26 + 6 * t), int(26 + 34 * t)))
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse((-60 * k, 150 * k, 220 * k, 420 * k), fill=90)
    from PIL import ImageFilter
    side.paste((165, 80, 167), (0, 0), glow.filter(ImageFilter.GaussianBlur(40 * k)))
    d = ImageDraw.Draw(side)
    icon = render(72 * k, bg=(255, 255, 235, 255), fg=DARK)
    side.paste(icon, ((w - icon.width) // 2, 46 * k), icon)
    def centered(text, y, font, fill):
        tw = d.textlength(text, font=font)
        d.text(((w - tw) / 2, y), text, font=font, fill=fill)
    centered("FreeFlow", 134 * k, bold(22 * k), CREAM)
    centered("Dictée vocale", 166 * k, regular(11 * k), (220, 210, 228))
    centered("100 % locale", 181 * k, regular(11 * k), (220, 210, 228))
    for i, hh in enumerate(BARS * 2):  # waveform motif at the bottom
        x = 22 * k + i * 9 * k
        bh = hh * 26 * k
        d.rounded_rectangle((x, 262 * k - bh / 2, x + 4 * k, 262 * k + bh / 2), radius=2 * k, fill=(240, 215, 255))
    centered("gratuit · sans compte", 292 * k, regular(9 * k), (170, 160, 180))
    side.resize((164, 314), Image.LANCZOS).save(os.path.join(out, "sidebar.bmp"))
    # header: white like the NSIS pages, logo + name on the right side
    hw, hh2 = 150 * k, 57 * k
    head = Image.new("RGB", (hw, hh2), (255, 255, 255))
    hd = ImageDraw.Draw(head)
    ic = render(34 * k)
    head.paste(ic, (hw - 40 * k, 11 * k), ic)
    name = "FreeFlow"
    hd.text((hw - 44 * k - hd.textlength(name, font=bold(15 * k)), 17 * k), name, font=bold(15 * k), fill=DARK)
    head.resize((150, 57), Image.LANCZOS).save(os.path.join(out, "header.bmp"))


def mac():
    # App icon: Apple's grid puts the rounded square at 824/1024 with a soft shadow.
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((100, 112, 924, 936), radius=185, fill=(0, 0, 0, 70))
    from PIL import ImageFilter
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
    canvas.alpha_composite(render(824), (100, 100))
    canvas.save(os.path.join(HERE, "icon.icns"), format="ICNS")
    # Menu bar: black bars on transparency ("Template" images are tinted by macOS).
    black = (0, 0, 0, 255)
    for size, suffix in ((16, ""), (32, "@2x")):
        render(size, bg=None, fg=black, rounded=False).save(os.path.join(HERE, f"trayTemplate{suffix}.png"))
        render(size, bg=None, fg=(0, 0, 0, 110), rounded=False).save(os.path.join(HERE, f"trayLoadingTemplate{suffix}.png"))
        render(size, dot=RED).save(os.path.join(HERE, f"tray-mac-rec{suffix}.png"))


if __name__ == "__main__":
    main()

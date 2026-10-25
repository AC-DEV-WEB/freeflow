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

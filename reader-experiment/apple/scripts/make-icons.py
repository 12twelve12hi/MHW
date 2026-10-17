"""Draws the Send to Daylight app icons (run: python3 scripts/make-icons.py from reader-experiment/apple)."""
import json
import os
from PIL import Image, ImageDraw, ImageFilter

S = 1024
AMBER_TOP, AMBER_BOTTOM = (247, 186, 77), (232, 128, 46)
PAPER = (255, 251, 242)
INK = (120, 62, 20)


def background(size, rounded):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    grad = Image.new('RGBA', (size, size))
    d = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / (size - 1)
        d.line([(0, y), (size, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(AMBER_TOP, AMBER_BOTTOM)) + (255,))
    if not rounded:
        return grad
    inset, radius = int(size * 0.098), int(size * 0.18)
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([inset, inset, size - inset, size - inset], radius, fill=255)
    shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([inset, inset + 12, size - inset, size - inset + 12], radius, fill=(0, 0, 0, 90))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
    img.paste(grad, (0, 0), mask)
    return img


def glyph(img, scale):
    d = ImageDraw.Draw(img)
    c = S / 2
    p = lambda x, y: (c + (x - c) * scale, c + (y - c) * scale)
    # A low sun on the horizon (the Daylight) ...
    r = 150 * scale
    d.pieslice([c - r, p(0, 700)[1] - r, c + r, p(0, 700)[1] + r], 180, 360, fill=(255, 226, 150, 255))
    d.line([p(170, 700), p(854, 700)], fill=PAPER + (255,), width=int(18 * scale))
    # ... and a paper plane flying to it.
    d.polygon([p(220, 430), p(820, 210), p(600, 640)], fill=PAPER + (255,))
    d.polygon([p(820, 210), p(470, 520), p(600, 640)], fill=(236, 226, 206, 255))
    d.polygon([p(470, 520), p(820, 210), p(440, 640)], fill=(222, 208, 182, 255))
    d.line([p(470, 520), p(820, 210)], fill=INK + (80,), width=int(6 * scale))


def save_set(folder, images):
    os.makedirs(folder, exist_ok=True)
    for name, img in images.items():
        img.save(os.path.join(folder, name))


ios = background(S, False)
glyph(ios, 1.0)
ios = ios.convert('RGB')  # no alpha on iOS icons
save_set('iOS/App/Assets.xcassets/AppIcon.appiconset', {'icon-1024.png': ios})
json.dump({'images': [{'filename': 'icon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}],
           'info': {'author': 'xcode', 'version': 1}},
          open('iOS/App/Assets.xcassets/AppIcon.appiconset/Contents.json', 'w'), indent=2)

mac = background(S, True)
glyph(mac, 0.80)
entries, files = [], {}
for pt in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        px = pt * scale
        name = f'icon-{pt}@{scale}x.png'
        files[name] = mac.resize((px, px), Image.LANCZOS)
        entries.append({'filename': name, 'idiom': 'mac', 'scale': f'{scale}x', 'size': f'{pt}x{pt}'})
save_set('macOS/App/Assets.xcassets/AppIcon.appiconset', files)
json.dump({'images': entries, 'info': {'author': 'xcode', 'version': 1}},
          open('macOS/App/Assets.xcassets/AppIcon.appiconset/Contents.json', 'w'), indent=2)
for cat in ('iOS/App/Assets.xcassets', 'macOS/App/Assets.xcassets'):
    json.dump({'info': {'author': 'xcode', 'version': 1}}, open(f'{cat}/Contents.json', 'w'), indent=2)
print('icons written')

"""Builds the MOAI OS app icons from the official cream monogram (public/brand/moai-icon-cream.png).
Outputs: web icons in public/ and desktop/AppIcon.iconset (turned into .icns by iconutil)."""
import os, sys
from PIL import Image, ImageDraw

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mono = Image.open(os.path.join(root, "public/brand/moai-icon-cream.png")).convert("RGBA")
mono = mono.crop(mono.getbbox())
INK = (34, 34, 34, 255)

def tile(size, rounded=True, margin=0.0):
    """Black Out tile with the monogram centred. margin: transparent border (macOS icon grid)."""
    S = size * 4  # supersample for smooth edges
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    m = int(S * margin)
    box = (m, m, S - m, S - m)
    d = ImageDraw.Draw(img)
    side = box[2] - box[0]
    if rounded:
        d.rounded_rectangle(box, radius=int(side * 0.225), fill=INK)
    else:
        d.rectangle(box, fill=INK)
    w = int(side * 0.62)
    h = int(w * mono.height / mono.width)
    g = mono.resize((w, h), Image.LANCZOS)
    img.alpha_composite(g, (box[0] + (side - w) // 2, box[1] + (side - h) // 2 + int(side * 0.01)))
    return img.resize((size, size), Image.LANCZOS)

pub = os.path.join(root, "public")
tile(192, rounded=False).save(os.path.join(pub, "icon-192.png"))
tile(512, rounded=False).save(os.path.join(pub, "icon-512.png"))
tile(180, rounded=False).convert("RGB").save(os.path.join(pub, "apple-touch-icon.png"))
tile(64, rounded=True).save(os.path.join(root, "src/app/icon.png"))

iconset = os.path.join(root, "desktop/AppIcon.iconset")
os.makedirs(iconset, exist_ok=True)
for base in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        px = base * scale
        # Apple grid: the rounded tile occupies ~80% of the canvas
        tile(px, rounded=True, margin=0.1).save(os.path.join(iconset, f"icon_{base}x{base}{'@2x' if scale == 2 else ''}.png"))
print("ok")

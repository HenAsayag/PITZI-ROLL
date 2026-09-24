"""Procedural, tileable textures + sprites for PITZI ROLL. Run: python3 tools/make_textures.py"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEX = ROOT / "assets/textures"; SPR = ROOT / "assets/sprites"
TEX.mkdir(parents=True, exist_ok=True); SPR.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(7)

def hexrgb(h): h = h.lstrip('#'); return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], float)

def tile_noise(n, cells, seed):
    r = np.random.default_rng(seed).random((cells, cells))
    big = Image.fromarray((np.tile(r, (3, 3)) * 255).astype(np.uint8)).resize((3*n, 3*n), Image.BICUBIC)
    return np.asarray(big, float)[n:2*n, n:2*n] / 255.0

def fbm(n, seed, octaves=(4, 8, 16, 32)):
    out = np.zeros((n, n)); w = 0
    for i, c in enumerate(octaves):
        a = 0.5 ** i; out += a * tile_noise(n, c, seed + i); w += a
    return out / w

def save(arr, path):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(path, optimize=True)

THEMES = {
    # name: (tile A, tile B, side color, sky top, sky bottom, sky style)
    "meadow":  ("#8FD67E", "#74C466", "#5A8F4E", "#6EC3FF", "#DDF3FF", "clouds"),
    "candy":   ("#FFB8D4", "#FFDDEB", "#D9749C", "#FF9FC8", "#FFF1D6", "clouds"),
    "factory": ("#A3ADB9", "#86919E", "#4E5663", "#2B3140", "#8C96A6", "haze"),
    "castle":  ("#D3C1A3", "#B39E7F", "#7D6A50", "#F6A96B", "#FFE3B3", "clouds"),
    "sky":     ("#EEF7FF", "#C9E4FF", "#8FB6E0", "#3E8EF7", "#E6F4FF", "clouds"),
    "neon":    ("#15183A", "#1D2150", "#0B0D22", "#05061A", "#2A1250", "stars"),
    "ice":     ("#E4F8FF", "#C6EEFF", "#86C5E0", "#9AD8FF", "#F5FCFF", "snow"),
}

def floor_texture(name, a, b, n=512, cells=4):
    A, B = hexrgb(a), hexrgb(b)
    y, x = np.mgrid[0:n, 0:n]; cs = n // cells
    chk = ((x // cs + y // cs) % 2)[..., None]
    img = A * (1 - chk) + B * chk
    img *= (0.94 + 0.12 * fbm(n, sum(map(ord, name))))[..., None]
    lx, ly = x % cs, y % cs
    bevel = np.where((lx < 5) | (ly < 5), 1.10, 1.0) * np.where((lx > cs - 6) | (ly > cs - 6), 0.86, 1.0)
    img *= bevel[..., None]
    if name == "neon":  # glowing grid lines
        d = np.minimum(np.minimum(lx, cs - lx), np.minimum(ly, cs - ly)).astype(float)
        glow = np.exp(-d / 3.0)[..., None]
        img = img * 0.9 + glow * hexrgb("#35E8FF") * 0.9
    if name == "ice":  # scratches
        im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)); dr = ImageDraw.Draw(im)
        for _ in range(60):
            x0, y0 = rng.integers(0, n, 2); L = rng.integers(20, 90); ang = rng.uniform(0, np.pi)
            dr.line([(x0, y0), (x0 + L*np.cos(ang), y0 + L*np.sin(ang))], fill=(255, 255, 255), width=1)
        img = np.asarray(im, float)
    save(img, TEX / f"floor_{name}.png")

def side_texture(name, c, n=256):
    C = hexrgb(c); y, x = np.mgrid[0:n, 0:n]
    img = C * (0.9 + 0.2 * fbm(n, 50 + len(name)))[..., None]
    img *= np.where((y % 64) < 4, 0.75, 1.0)[..., None]           # horizontal courses
    img *= np.where(y < 10, 1.25, 1.0)[..., None]                  # top lip highlight
    save(img, TEX / f"side_{name}.png")

def sky_texture(name, top, bot, style, w=2048, h=1024):
    T, Bc = hexrgb(top), hexrgb(bot)
    t = np.linspace(0, 1, h)[:, None, None] ** 0.8
    img = np.broadcast_to(T * (1 - t) + Bc * t, (h, w, 3)).copy()
    if style in ("clouds", "snow"):
        n = fbm(1024, 300 + len(name), (6, 12, 24, 48))
        n = np.asarray(Image.fromarray((n * 255).astype(np.uint8)).resize((w, h)), float) / 255
        band = np.exp(-((np.linspace(0, 1, h) - 0.55) / 0.18) ** 2)[:, None]
        cl = np.clip((n - 0.52) * 5, 0, 1) * band
        img = img * (1 - cl[..., None]) + 255 * cl[..., None]
    if style == "stars":
        s = rng.random((h, w)) > 0.9985
        img[s] = 255
        haze = np.exp(-((np.linspace(0, 1, h) - 0.8) / 0.15) ** 2)[:, None, None]
        img = img + haze * hexrgb("#FF3FA4") * 0.35
    if style == "snow":
        for _ in range(900):
            x0, y0 = rng.integers(0, w), rng.integers(0, h)
            img[y0:y0+2, x0:x0+2] = 255
    if style == "haze":
        img *= (0.9 + 0.15 * np.asarray(Image.fromarray((fbm(1024, 77)*255).astype(np.uint8)).resize((w, h)), float)/255)[..., None]
    save(img, TEX / f"sky_{name}.png")

# ---------- supersampled RGBA sprite helper ----------
def canvas(n=256, ss=4):
    im = Image.new("RGBA", (n*ss, n*ss), (0, 0, 0, 0)); return im, ImageDraw.Draw(im), ss
def finish(im, n, path): im.resize((n, n), Image.LANCZOS).save(path, optimize=True)

def pad_speed():
    im, d, s = canvas(); N = 256*s
    d.rounded_rectangle([8*s, 8*s, N-8*s, N-8*s], 28*s, fill=(30, 34, 60, 255), outline=(255, 214, 61, 255), width=8*s)
    for i in range(3):
        y = N*0.72 - i*N*0.2
        d.polygon([(N*0.22, y), (N*0.5, y - N*0.16), (N*0.78, y), (N*0.78, y+N*0.07), (N*0.5, y - N*0.09), (N*0.22, y+N*0.07)], fill=(255, 214, 61, 255 - i*50))
    finish(im, 256, TEX / "pad_speed.png")  # arrow points to -V (texture "up" = travel direction)

def pad_bonus():
    im, d, s = canvas(); N = 256*s
    d.ellipse([10*s, 10*s, N-10*s, N-10*s], fill=(120, 20, 30, 255))
    d.ellipse([28*s, 22*s, N-28*s, N-34*s], fill=(240, 60, 70, 255))
    d.ellipse([60*s, 40*s, N*0.55, N*0.35], fill=(255, 140, 140, 180))
    # "+5" as blocky strokes (font-free)
    w = 16*s; cx, cy = N*0.5, N*0.5
    d.rectangle([cx-80*s, cy-w/2, cx-24*s, cy+w/2], fill="white"); d.rectangle([cx-52*s-w/2, cy-28*s, cx-52*s+w/2, cy+28*s], fill="white")
    x0 = cx+4*s
    for r in ([x0, cy-44*s, x0+64*s, cy-44*s+w], [x0, cy-44*s, x0+w, cy+2*s], [x0, cy-6*s, x0+64*s, cy-6*s+w],
              [x0+64*s-w, cy-6*s, x0+64*s, cy+44*s], [x0, cy+44*s-w, x0+64*s, cy+44*s]):
        d.rectangle(r, fill="white")
    finish(im, 256, TEX / "pad_bonus.png")

def checker_ring(path, inner, color):
    im, d, s = canvas(); N = 256*s; c = N/2
    for k in range(24):
        a0, a1 = k*15, k*15+15
        d.pieslice([4*s, 4*s, N-4*s, N-4*s], a0, a1, fill=(20, 20, 30, 255) if k % 2 else (255, 255, 255, 255))
    d.ellipse([c-inner*s, c-inner*s, c+inner*s, c+inner*s], fill=color)
    finish(im, 256, path)

def pad_generic(path, base, ring, glyph):
    im, d, s = canvas(); N = 256*s
    d.ellipse([8*s, 8*s, N-8*s, N-8*s], fill=base, outline=ring, width=12*s)
    glyph(d, N, s); finish(im, 256, path)

def tar():
    n = 512; f = fbm(n, 900, (8, 16, 32, 64))
    img = np.stack([f*40+10, f*25+8, f*50+20], -1)
    bub = (tile_noise(n, 48, 901) > 0.78)
    img[bub] = img[bub] * 0.6 + 60
    save(img, TEX / "surface_tar.png")

def collapse_tile():
    n = 256; im = Image.new("RGB", (n, n), (200, 150, 110)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, n-1, n-1], outline=(120, 80, 50), width=10)
    for _ in range(7):
        pts = [(n/2, n/2)]; a = rng.uniform(0, 2*np.pi); r = 0
        while r < n*0.6:
            r += rng.uniform(15, 30); a += rng.uniform(-0.5, 0.5); pts.append((n/2 + r*np.cos(a), n/2 + r*np.sin(a)))
        d.line(pts, fill=(90, 55, 35), width=4)
    im.save(TEX / "surface_collapse.png")

def glass_floor():
    n = 512; y, x = np.mgrid[0:n, 0:n]
    a = np.full((n, n), 70.0); a[(x % 128 < 3) | (y % 128 < 3)] = 200
    img = np.dstack([np.full((n, n), 200.0), np.full((n, n), 240.0), np.full((n, n), 255.0), a])
    Image.fromarray(img.astype(np.uint8), "RGBA").save(TEX / "surface_glass.png", optimize=True)

def ball_maps():
    n = 1024; im = Image.new("L", (n, n//2), 40); d = ImageDraw.Draw(im)   # equirect roughness
    for _ in range(140):
        x0, y0 = rng.integers(0, n), rng.integers(0, n//2); L = rng.integers(10, 60); a = rng.uniform(0, np.pi)
        d.line([(x0, y0), (x0+L*np.cos(a), y0+L*np.sin(a))], fill=int(rng.integers(90, 170)), width=1)
    d.rectangle([0, n//4 - 6, n, n//4 + 6], fill=170)   # seam around equator
    im.filter(ImageFilter.GaussianBlur(0.6)).save(TEX / "ball_roughness.png", optimize=True)
    # seam colour band (alpha): tinted ring where the two halves of the ball meet
    im2 = Image.new("RGBA", (n, n//2), (0, 0, 0, 0)); d2 = ImageDraw.Draw(im2)
    d2.rectangle([0, n//4 - 7, n, n//4 + 7], fill=(255, 255, 255, 110))
    for k in range(0, n, 128): d2.ellipse([k+58, n//4-5, k+70, n//4+5], fill=(255, 255, 255, 200))   # vent holes
    im2.save(TEX / "ball_seam.png", optimize=True)

def particles():
    def star(path, color):
        im, d, s = canvas(128); N = 128*s; c = N/2
        pts = [(c + (N*0.46 if i % 2 == 0 else N*0.2)*np.cos(-np.pi/2 + i*np.pi/5),
                c + (N*0.46 if i % 2 == 0 else N*0.2)*np.sin(-np.pi/2 + i*np.pi/5)) for i in range(10)]
        d.polygon(pts, fill=color, outline=(60, 40, 0, 255), width=4*s); finish(im, 128, path)
    star(SPR / "star_dizzy.png", (255, 214, 61, 255))
    n = 128; y, x = np.mgrid[0:n, 0:n] - n/2; r = np.hypot(x, y)/(n/2)
    soft = np.clip(1 - r, 0, 1) ** 2
    Image.fromarray(np.dstack([np.full((n, n), 255)]*3 + [soft*255]).astype(np.uint8), "RGBA").save(SPR / "soft_dot.png")
    spark = np.clip(np.exp(-np.abs(x)/3) + np.exp(-np.abs(y)/3), 0, 1) * np.clip(1 - r, 0, 1)
    Image.fromarray(np.dstack([np.full((n, n), 255)]*3 + [spark*255]).astype(np.uint8), "RGBA").save(SPR / "sparkle.png")
    dust = soft * (0.6 + 0.4*tile_noise(n, 8, 3))
    Image.fromarray(np.dstack([np.full((n, n), 235), np.full((n, n), 220), np.full((n, n), 190), dust*200]).astype(np.uint8), "RGBA").save(SPR / "dust.png")
    im, d, s = canvas(128); N = 128*s
    d.polygon([(N*0.2, N*0.1), (N*0.85, N*0.35), (N*0.55, N*0.9), (N*0.15, N*0.6)], fill=(200, 240, 255, 200), outline=(255, 255, 255, 255), width=3*s)
    finish(im, 128, SPR / "glass_shard.png")
    # contact shadow blob
    Image.fromarray(np.dstack([np.zeros((n, n))]*3 + [np.clip(1 - r, 0, 1)**1.5*170]).astype(np.uint8), "RGBA").save(SPR / "shadow_blob.png")

if __name__ == "__main__":
    for k, (a, b, side, top, bot, style) in THEMES.items():
        floor_texture(k, a, b); side_texture(k, side); sky_texture(k, top, bot, style)
    pad_speed(); pad_bonus()
    checker_ring(TEX / "pad_goal.png", 70, (255, 200, 61, 255))
    checker_ring(TEX / "pad_checkpoint.png", 80, (60, 170, 255, 255))
    pad_generic(TEX / "pad_launcher.png", (255, 120, 40, 255), (255, 240, 200, 255),
                lambda d, N, s: d.polygon([(N*.5, N*.18), (N*.78, N*.55), (N*.6, N*.55), (N*.6, N*.8), (N*.4, N*.8), (N*.4, N*.55), (N*.22, N*.55)], fill="white"))
    pad_generic(TEX / "bumper_top.png", (255, 79, 139, 255), (255, 255, 255, 255),
                lambda d, N, s: [d.ellipse([N*f, N*f, N*(1-f), N*(1-f)], outline=(255, 255, 255, 220), width=6*s) for f in (0.2, 0.32)])
    tar(); collapse_tile(); glass_floor(); ball_maps(); particles()
    print("textures:", len(list(TEX.glob('*.png'))), "sprites:", len(list(SPR.glob('*.png'))))

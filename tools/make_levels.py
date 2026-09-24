"""Level data (segment chains) -> levels/levels.json + validation + top-down/profile previews.
Coordinate system (same as the game): Y up, start faces -Z. heading h (deg): dir=(sin h, 0, -cos h),
right=(cos h, 0, sin h). Positive curve angle turns RIGHT. `drop` = height change over the segment (negative = downhill)."""
import json, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LV = ROOT / "levels"; PREV = LV / "previews"; PREV.mkdir(parents=True, exist_ok=True)

HAZARDS = {"bumper", "rival", "spinner", "hammer", "saw", "mover", "launcher", "speedpad", "bonus", "goal", "start"}
SURFACES = {"normal", "ice", "tar", "glass"}
RAILS = {"both", "left", "right", "none"}

def S(L, w=6, drop=0, rails="both", **k): return dict(type="straight", length=L, width=w, drop=drop, rails=rails, **k)
def C(A, R, w=5, drop=0, rails="both", **k): return dict(type="curve", angle=A, radius=R, width=w, drop=drop, rails=rails, **k)
def P(w=10, d=10, drop=0, rails="none", **k): return dict(type="platform", width=w, length=d, drop=drop, rails=rails, **k)
def GAP(L, drop=0, **k): return dict(type="gap", length=L, width=4, drop=drop, rails="none", **k)
def TUBE(L, drop, **k): return dict(type="tube", length=L, width=3, drop=drop, rails="none", **k)
def LIFT(h, **k): return dict(type="lift", length=3, width=3, drop=h, rails="none", **k)
def H(type, at=0.5, x=0.0, **p): return dict(type=type, at=at, x=x, **p)

LEVELS = [
 dict(id="warmup", name={"he": "מסלול חימום", "en": "Warm-Up Lane"}, theme="meadow",
      desc={"he": "גלגלו, תרגישו את הכדור, הגיעו לדגל.", "en": "Roll, feel the ball, reach the flag."},
      segments=[S(14, 7, -1.5, hazards=[H("start", .2)]), C(90, 9, 7, -1), S(12, 6, -2, hazards=[H("speedpad", .5)]),
                S(6, 6, 0, checkpoint=True), C(-90, 9, 6, -1), S(10, 6, -1.5, "none"), P(10, 10, hazards=[H("goal", .6)])]),
 dict(id="bumpers", name={"he": "גשרי הקפיצים", "en": "Bumper Bridges"}, theme="meadow",
      desc={"he": "גשרים צרים, באמפרים ששולחים אותך עף, ויריב שרוצה להפיל אותך.", "en": "Narrow bridges, bouncy bumpers and a pushy rival."},
      segments=[S(10, 7, -1, hazards=[H("start", .3)]), S(12, 3, -1, "none"),
                P(12, 12, checkpoint=True, hazards=[H("bumper", .3, -.5), H("bumper", .3, .5), H("bumper", .7, 0)]),
                C(90, 7, 5, -1, "left"), S(14, 2.5, -1.5, "none"), P(10, 10, checkpoint=True, hazards=[H("rival", .5)]),
                C(-120, 6, 5, -1, "right"), S(10, 5, -2, hazards=[H("speedpad", .3)]), P(10, 10, hazards=[H("goal", .6)])]),
 dict(id="zigzag", name={"he": "זיגזג ממתקים", "en": "Candy Zigzag"}, theme="candy",
      desc={"he": "פניות חדות בלי מעקות, שלולית זפת דביקה וכפתור בונוס מוסתר בצד.", "en": "Rail-less zigzags, sticky tar and a hidden bonus button."},
      segments=[S(8, 6, -1, hazards=[H("start", .3)]), C(60, 6, 3.5, -1, "none"), C(-120, 6, 3.5, -1.5, "none"),
                C(120, 6, 3.5, -1.5, "none", checkpoint=True), S(10, 5, -.5, surface="tar"),
                C(-90, 8, 4, -1, "none", hazards=[H("bonus", .5, .75, seconds=5)]), S(12, 3, -2, "none", hazards=[H("spinner", .5, length=2.6, speed=1.6)]),
                P(12, 12, checkpoint=True, hazards=[H("bumper", .3, -.5), H("bumper", .3, .5), H("bumper", .7, -.5), H("bumper", .7, .5)]),
                C(90, 6, 3, -1, "none"), S(8, 5, -1), P(10, 10, hazards=[H("goal", .6)])]),
 dict(id="pipeworks", name={"he": "מפעל הצינורות", "en": "Pipe Works"}, theme="factory",
      desc={"he": "צינור ירידה, פטישים הידראוליים, אריחים מתפוררים ושואב שמרים אותך למעלה.", "en": "Drop tubes, hydraulic hammers, crumbling tiles and a vacuum lift."},
      segments=[S(10, 6, -1, hazards=[H("start", .3)]), P(10, 10, hazards=[H("hammer", .5, 0, period=2.2)]), TUBE(18, -8),
                P(12, 12, checkpoint=True, hazards=[H("hammer", .3, -.5, period=1.8), H("hammer", .7, .5, period=1.8, phase=.5)]),
                S(12, 4, 0, "none", collapse=True), LIFT(7), P(10, 10, checkpoint=True),
                C(-90, 7, 4, -1, "none"), S(14, 4, -3, hazards=[H("speedpad", .2)]), P(10, 10, hazards=[H("goal", .6)])]),
 dict(id="castle", name={"he": "טיפוס לטירה", "en": "Castle Climb"}, theme="castle",
      desc={"he": "עולים! זרוע מסתובבת, מקפצה מעל תהום ופלטפורמה נעה.", "en": "Uphill! A spinning arm, a launcher over a chasm and a moving platform."},
      segments=[S(10, 6, 0, hazards=[H("start", .3)]), S(14, 5, 3, hazards=[H("speedpad", .1)]),
                P(14, 14, checkpoint=True, hazards=[H("spinner", .5, length=11, speed=1.0)]),
                S(6, 4, 0, "none", hazards=[H("launcher", .7, power=1.0)]), GAP(10, 1), P(10, 10, checkpoint=True),
                GAP(12, 0, hazards=[H("mover", .5, travel=10, period=4)]), P(10, 10), C(180, 9, 4, 2, "left"),
                S(10, 4, 1.5, hazards=[H("rival", .5)]), P(12, 12, hazards=[H("goal", .6)])]),
 dict(id="skystairs", name={"he": "מדרגות לשמיים", "en": "Sky Stairs"}, theme="sky",
      desc={"he": "המרוץ היחיד שכולו למעלה: שואבים, רמפות האצה וכפתור +5 שנ׳.", "en": "An all-uphill race: vacuums, boost ramps and a +5s button."},
      segments=[P(10, 10, hazards=[H("start", .4)]), LIFT(8), S(10, 3, 1, "none", hazards=[H("speedpad", .3)]), C(90, 5, 3, 1, "none"), LIFT(6),
                P(10, 10, checkpoint=True, hazards=[H("bonus", .5, .7, seconds=5)]),
                S(12, 2.5, 2, "none", hazards=[H("speedpad", .2), H("speedpad", .6)]), GAP(6, 0, hazards=[H("mover", .5, travel=5, period=3)]),
                P(8, 8, checkpoint=True), LIFT(8), P(12, 12, hazards=[H("goal", .6)])]),
 dict(id="neongrid", name={"he": "רשת הניאון", "en": "Neon Grid"}, theme="neon",
      desc={"he": "לילה בעיר הדיגיטלית: אריחים נופלים, מסורים ורצפת זכוכית.", "en": "Night in the digital city: falling tiles, saws and a glass floor."},
      segments=[S(10, 6, -1, hazards=[H("start", .3)]), S(16, 6, -1, "none", collapse=True),
                P(14, 14, checkpoint=True, hazards=[H("spinner", .5, length=12, speed=1.4)]),
                C(-90, 8, 4, -2, "none", hazards=[H("saw", .5, travel=3.2, period=2.5)]),
                GAP(14, -1, hazards=[H("mover", .5, travel=11, period=4.5)]), P(10, 10, checkpoint=True),
                S(18, 3, -2, "none", hazards=[H("rival", .3), H("bumper", .7, 0)]), C(90, 6, 4, -1, "left", surface="glass"),
                P(12, 12, hazards=[H("goal", .6)])]),
 dict(id="glassrink", name={"he": "משטח הקרח", "en": "Glass Rink"}, theme="ice",
      desc={"he": "הגמר: קרח חלקלק, זכוכית, מסורים וכל מה שלמדת.", "en": "The finale: slippery ice, glass, saws and everything you learned."},
      segments=[S(12, 7, -2, surface="ice", hazards=[H("start", .2)]), C(90, 10, 6, -1, "left", surface="ice"),
                P(16, 16, checkpoint=True, surface="ice", hazards=[H("bumper", .3, -.5), H("bumper", .3, .5), H("bumper", .7, 0), H("rival", .6, .4)]),
                S(14, 3, -2, "none", surface="glass", hazards=[H("saw", .5, travel=2.4, period=2)]), TUBE(14, -6),
                P(12, 12, checkpoint=True, hazards=[H("spinner", .5, length=10, speed=1.2)]), C(-180, 7, 4, -2, "right", surface="ice"),
                S(6, 4, 0, "none", hazards=[H("launcher", .7, power=1.0)]), GAP(12, -2), P(10, 10, checkpoint=True),
                S(16, 2.5, -3, "none", collapse=True), P(12, 12, hazards=[H("goal", .6)])]),
]

def rightv(h): r = math.radians(h); return (math.cos(r), math.sin(r))
def dirv(h): r = math.radians(h); return (math.sin(r), -math.cos(r))

def walk(level, y0=30.0):
    """Annotate every segment with start/end pose + sampled centerline; return total path length."""
    x, z, y, h = 0.0, 0.0, y0, 0.0; total = 0.0
    for seg in level["segments"]:
        seg["_start"] = dict(x=x, y=y, z=z, heading=h); pts = []
        if seg["type"] == "curve":
            A, R = seg["angle"], seg["radius"]; s = 1 if A > 0 else -1; rx, rz = rightv(h)
            cx, cz = x + rx*R*s, z + rz*R*s
            for i in range(33):
                u = i/32; hh = h + A*u; rx2, rz2 = rightv(hh)
                pts.append((cx - rx2*R*s, cz - rz2*R*s, y + seg["drop"]*u, hh))
            L = abs(math.radians(A))*R
        else:
            L = seg["length"]; dx, dz = dirv(h)
            pts = [(x + dx*L*i/16, z + dz*L*i/16, y + seg["drop"]*i/16, h) for i in range(17)]
        seg["_pts"] = pts; x, z, y, h = pts[-1]; total += L if seg["type"] != "lift" else 0
        seg["_len"] = L
    return total

def validate(level):
    errs = []; segs = level["segments"]
    kinds = [hz["type"] for s in segs for hz in s.get("hazards", [])]
    if kinds.count("start") != 1: errs.append("exactly one start")
    if kinds.count("goal") != 1: errs.append("exactly one goal")
    if "goal" not in [hz["type"] for hz in segs[-1].get("hazards", [])]: errs.append("goal must be on last segment")
    if not any(s.get("checkpoint") for s in segs): errs.append("needs >=1 checkpoint")
    for i, s in enumerate(segs):
        if s["rails"] not in RAILS: errs.append(f"seg{i} rails")
        if s.get("surface", "normal") not in SURFACES: errs.append(f"seg{i} surface")
        for hz in s.get("hazards", []):
            if hz["type"] not in HAZARDS: errs.append(f"seg{i} hazard {hz['type']}")
        if s["type"] == "gap":
            prev = segs[i-1]; has_mover = any(h["type"] == "mover" for h in s.get("hazards", []))
            has_launch = any(h["type"] in ("launcher", "speedpad") for h in prev.get("hazards", []))
            if not (has_mover or has_launch): errs.append(f"seg{i} gap is not crossable (needs mover, or launcher/speedpad before)")
            if i+1 >= len(segs) or segs[i+1]["type"] != "platform": errs.append(f"seg{i} gap must land on a platform")
        if s["type"] == "curve" and s["radius"] < s["width"]/2 + 1: errs.append(f"seg{i} curve radius too tight")
    # footprint overlap: non-neighbour segments may only cross if vertically separated by >= 4 m
    for i in range(len(segs)):
        for j in range(i+2, len(segs)):
            a, b = segs[i], segs[j]
            if "gap" in (a["type"], b["type"]): continue
            for p in a["_pts"]:
                for q in b["_pts"]:
                    if math.hypot(p[0]-q[0], p[1]-q[1]) < (a["width"]+b["width"])/2*0.9 and abs(p[2]-q[2]) < 4:
                        errs.append(f"seg{i} overlaps seg{j} (dy={abs(p[2]-q[2]):.1f})"); break
                else: continue
                break
    return errs

def times(level, L):
    """Starting values for tuning; assume ~6.5 m/s avg roll + fixed time for tubes/lifts."""
    fixed = sum(2.5 for s in level["segments"] if s["type"] in ("tube", "lift"))
    base = L/6.5 + fixed
    r = lambda v: round(v*2)/2
    return dict(raceTime=r(base*1.6 + 8), par=r(base*1.15), medals=dict(bronze=r(base*1.35), silver=r(base*1.1), gold=r(base*0.95), acorn=r(base*0.85)))

# ---------------- previews ----------------
COL = dict(start=(60, 200, 90), goal=(255, 200, 61), bumper=(255, 79, 139), rival=(40, 40, 60), spinner=(160, 90, 255),
           hammer=(120, 120, 140), saw=(230, 40, 40), mover=(80, 200, 255), launcher=(255, 120, 40), speedpad=(255, 214, 61), bonus=(240, 60, 70))
SURF = dict(normal=None, ice=(200, 240, 255), tar=(50, 35, 60), glass=(170, 230, 255))
def font(sz):
    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",):
        try: return ImageFont.truetype(f, sz)
        except Exception: pass
    return ImageFont.load_default()

def height_color(y, ymin, ymax):
    u = 0 if ymax == ymin else (y - ymin)/(ymax - ymin)
    a, b = (70, 110, 200), (255, 170, 80)
    return tuple(int(a[i] + (b[i]-a[i])*u) for i in range(3))

def preview(level, L, tm):
    allp = [p for s in level["segments"] for p in s["_pts"]]
    pad = 12; xs = [p[0] for p in allp]; zs = [p[1] for p in allp]; ys = [p[2] for p in allp]
    minx, maxx, minz, maxz = min(xs)-pad, max(xs)+pad, min(zs)-pad, max(zs)+pad
    W = 900; sc = min((W-40)/(maxx-minx), 620/(maxz-minz)); Hh = int((maxz-minz)*sc) + 40
    img = Image.new("RGB", (W, Hh + 260), (246, 243, 236)); d = ImageDraw.Draw(img)
    T = lambda x, z: (20 + (x-minx)*sc, 20 + (z-minz)*sc)
    ymin, ymax = min(ys), max(ys)
    for s in level["segments"]:
        pts = s["_pts"]; hw = s["width"]/2
        if s["type"] == "platform":
            hw = s["width"]/2
        if s["type"] == "gap":
            d.line([T(p[0], p[1]) for p in pts], fill=(200, 200, 210), width=2)
            for hz in s.get("hazards", []):
                if hz["type"] == "mover":
                    p = pts[len(pts)//2]; d.ellipse([T(p[0], p[1])[0]-8, T(p[0], p[1])[1]-8, T(p[0], p[1])[0]+8, T(p[0], p[1])[1]+8], outline=COL["mover"], width=3)
            continue
        for a, b in zip(pts, pts[1:]):
            ra, rb = rightv(a[3]), rightv(b[3])
            poly = [T(a[0]-ra[0]*hw, a[1]-ra[1]*hw), T(a[0]+ra[0]*hw, a[1]+ra[1]*hw), T(b[0]+rb[0]*hw, b[1]+rb[1]*hw), T(b[0]-rb[0]*hw, b[1]-rb[1]*hw)]
            c = SURF.get(s.get("surface", "normal")) or height_color(a[2], ymin, ymax)
            if s["type"] == "tube": c = (150, 150, 160)
            if s["type"] == "lift": c = (120, 220, 200)
            if s.get("collapse"): c = (200, 150, 110)
            d.polygon(poly, fill=c)
        for side, sgn in (("left", -1), ("right", 1)):
            if s["rails"] in (side, "both"):
                d.line([T(p[0]+rightv(p[3])[0]*hw*sgn, p[1]+rightv(p[3])[1]*hw*sgn) for p in pts], fill=(40, 40, 60), width=3)
        if s.get("checkpoint"):
            p = pts[0]; r = rightv(p[3]); d.line([T(p[0]-r[0]*hw, p[1]-r[1]*hw), T(p[0]+r[0]*hw, p[1]+r[1]*hw)], fill=(60, 170, 255), width=5)
        for hz in s.get("hazards", []):
            i = min(len(pts)-1, int(round(hz["at"]*(len(pts)-1)))); p = pts[i]; r = rightv(p[3])
            cx, cz = T(p[0] + r[0]*hw*hz["x"], p[1] + r[1]*hw*hz["x"]); c = COL[hz["type"]]; R = 9 if hz["type"] not in ("goal", "start") else 12
            d.ellipse([cx-R, cz-R, cx+R, cz+R], fill=c, outline=(20, 20, 30), width=2)
    # profile strip
    top = Hh + 20; d.rectangle([20, top, W-20, top+120], outline=(200, 200, 200))
    acc = 0; prof = []
    for s in level["segments"]:
        for i, p in enumerate(s["_pts"]): prof.append((acc + s["_len"]*i/(len(s["_pts"])-1) if s["type"] != "lift" else acc + 0.01*i, p[2], s["type"]))
        acc += s["_len"] if s["type"] != "lift" else 0
    tot = max(1, acc); span = max(1, ymax-ymin)
    Pp = lambda u, y: (30 + u/tot*(W-60), top + 110 - (y-ymin)/span*100)
    for a, b in zip(prof, prof[1:]):
        d.line([Pp(a[0], a[1]), Pp(b[0], b[1])], fill=(220, 220, 225) if b[2] == "gap" else (40, 60, 120), width=3)
    f1, f2 = font(28), font(18)
    d.text((20, top+132), f"{level['name']['en']}  ·  theme: {level['theme']}", fill=(27, 31, 59), font=f1)
    m = tm["medals"]
    d.text((20, top+172), f"path ≈ {L:.0f} m   raceTime {tm['raceTime']}s   par {tm['par']}s   bronze {m['bronze']} / silver {m['silver']} / gold {m['gold']} / acorn {m['acorn']}", fill=(60, 60, 80), font=f2)
    lx = 20
    for k, c in COL.items():
        d.ellipse([lx, top+212, lx+14, top+226], fill=c, outline=(20, 20, 30)); d.text((lx+18, top+209), k, fill=(60, 60, 80), font=f2); lx += 28 + d.textlength(k, font=f2)
    img.save(PREV / f"{level['id']}.png", optimize=True)
    return img

if __name__ == "__main__":
    out = []; thumbs = []; ok = True
    for lv in LEVELS:
        L = walk(lv); errs = validate(lv); tm = times(lv, L)
        if errs: ok = False; print("✗", lv["id"], errs)
        thumbs.append(preview(lv, L, tm))
        ymin = min(p[2] for s in lv["segments"] for p in s["_pts"])
        clean = {k: v for k, v in lv.items() if k != "segments"}
        clean.update(tm, killY=round(ymin - 8, 2), pathLength=round(L, 1),
                     segments=[{**{k: v for k, v in s.items() if not k.startswith("_")},
                                "start": {k: round(v, 3) for k, v in s["_start"].items()}} for s in lv["segments"]])
        out.append(clean); print(f"✓ {lv['id']:10s} {L:6.1f} m  race {tm['raceTime']}s  gold {tm['medals']['gold']}s")
    json.dump({"version": 1, "units": "meters/seconds", "ballRadius": 0.5,
               "conventions": "Y up; heading deg, dir=(sin h,0,-cos h); +angle turns right; drop=Δy over segment; hazard.at 0..1 along segment; hazard.x -1..1 across half-width (+ = right)",
               "levels": out}, open(LV/"levels.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    # overview sheet
    tw = 450; sheet = Image.new("RGB", (tw*4, 0 or 1), "white"); rows = []
    th = [t.resize((tw, int(t.height*tw/t.width))) for t in thumbs]; hmax = max(t.height for t in th)
    sheet = Image.new("RGB", (tw*4, hmax*2), (246, 243, 236))
    for i, t in enumerate(th): sheet.paste(t, ((i % 4)*tw, (i//4)*hmax))
    sheet.save(PREV/"_overview.png", optimize=True)
    print("valid" if ok else "INVALID")

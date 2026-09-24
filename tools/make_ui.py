"""Original SVG UI art (logo, Pitzi the hamster, icons, medals) + PNG renders via headless Chromium."""
from pathlib import Path
import base64, asyncio
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "assets/ui"; IC = ROOT / "assets/icons"; FONTS = ROOT / "assets/fonts"
UI.mkdir(parents=True, exist_ok=True); IC.mkdir(parents=True, exist_ok=True)

P = dict(navy="#1B1F3B", cream="#FFF4E0", orange="#F4A259", orange_d="#D9823B", pink="#FF8FB1",
         glass="#7FDBFF", magenta="#FF4F8B", lime="#B8F35A", gold="#FFC83D", white="#FFFFFF")

# ---------- Pitzi the hamster (original character) ----------
def hamster(eyes="open", extra=""):
    E = {
        "open": f'''<ellipse cx="84" cy="98" rx="9" ry="11" fill="{P['navy']}"/><ellipse cx="136" cy="98" rx="9" ry="11" fill="{P['navy']}"/>
                   <circle cx="87" cy="94" r="3.5" fill="#fff"/><circle cx="139" cy="94" r="3.5" fill="#fff"/>''',
        "happy": f'''<path d="M74 100 Q84 88 94 100" stroke="{P['navy']}" stroke-width="5" fill="none" stroke-linecap="round"/>
                    <path d="M126 100 Q136 88 146 100" stroke="{P['navy']}" stroke-width="5" fill="none" stroke-linecap="round"/>''',
        "dizzy": f'''<path d="M84 98 m-9 0 a9 9 0 1 1 9 9 a6 6 0 1 1 -6 -6 a3 3 0 1 1 3 3" stroke="{P['navy']}" stroke-width="3.5" fill="none"/>
                    <path d="M136 98 m-9 0 a9 9 0 1 1 9 9 a6 6 0 1 1 -6 -6 a3 3 0 1 1 3 3" stroke="{P['navy']}" stroke-width="3.5" fill="none"/>''',
    }[eyes]
    return f'''<g>
  <ellipse cx="110" cy="190" rx="62" ry="10" fill="#000" opacity=".12"/>
  <circle cx="62" cy="58" r="22" fill="{P['orange_d']}"/><circle cx="62" cy="58" r="12" fill="{P['pink']}"/>
  <circle cx="158" cy="58" r="22" fill="{P['orange_d']}"/><circle cx="158" cy="58" r="12" fill="{P['pink']}"/>
  <path d="M110 40 C168 40 186 90 184 128 C182 172 150 190 110 190 C70 190 38 172 36 128 C34 90 52 40 110 40Z" fill="{P['orange']}"/>
  <path d="M110 92 C150 92 162 120 160 146 C158 176 138 186 110 186 C82 186 62 176 60 146 C58 120 70 92 110 92Z" fill="{P['cream']}"/>
  <path d="M110 44 C118 60 118 72 110 84 C102 72 102 60 110 44Z" fill="{P['cream']}" opacity=".7"/>
  {E}
  <ellipse cx="66" cy="122" rx="12" ry="7" fill="{P['pink']}" opacity=".7"/><ellipse cx="154" cy="122" rx="12" ry="7" fill="{P['pink']}" opacity=".7"/>
  <path d="M104 114 L116 114 L110 121Z" fill="{P['magenta']}"/>
  <path d="M110 121 Q104 130 97 127 M110 121 Q116 130 123 127" stroke="{P['navy']}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <ellipse cx="88" cy="160" rx="11" ry="8" fill="{P['orange_d']}"/><ellipse cx="132" cy="160" rx="11" ry="8" fill="{P['orange_d']}"/>
  {extra}
</g>'''

def ball_wrap(inner, size=220):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">
  <defs><radialGradient id="g" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".55"/>
  <stop offset=".6" stop-color="{P['glass']}" stop-opacity=".18"/><stop offset="1" stop-color="{P['glass']}" stop-opacity=".55"/></radialGradient></defs>
  <g transform="translate(22 22) scale(.8)">{inner}</g>
  <circle cx="110" cy="110" r="104" fill="url(#g)" stroke="{P['glass']}" stroke-width="5"/>
  <path d="M8 110 Q110 138 212 110" stroke="#fff" stroke-opacity=".6" stroke-width="4" fill="none"/>
  <path d="M46 52 Q70 26 104 20" stroke="#fff" stroke-width="10" stroke-linecap="round" fill="none" opacity=".85"/>
</svg>'''

def plain(inner, size=220):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">{inner}</svg>'

STARS = ''.join(f'<path transform="translate({x} {y}) scale(.5)" d="M0-20 L6-6 21-6 9 3 13 18 0 9-13 18-9 3-21-6-6-6Z" fill="{P["gold"]}" stroke="{P["navy"]}" stroke-width="3"/>'
                for x, y in ((60, 24), (110, 12), (160, 24)))

# ---------- Logo ----------
FONT_STACK = "Rubik, 'Arial Black', sans-serif"
LOGO = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 300">
  <defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{P['gold']}"/><stop offset="1" stop-color="{P['orange']}"/></linearGradient>
  <radialGradient id="b" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="{P['glass']}" stop-opacity=".5"/></radialGradient></defs>
  <g font-family="{FONT_STACK}" font-weight="900" font-size="150" text-anchor="middle" stroke="{P['navy']}" stroke-width="22" stroke-linejoin="round" paint-order="stroke">
    <text x="300" y="165" fill="url(#t)">PITZI</text>
    <text x="330" y="280" fill="{P['glass']}" font-size="110">ROLL</text>
  </g>
  <g transform="translate(640 150)"><g transform="translate(-110 -110)">{ball_wrap(hamster()).split('>',1)[1].rsplit('</svg>',1)[0]}</g></g>
  <text x="640" y="292" font-family="{FONT_STACK}" font-weight="800" font-size="34" text-anchor="middle" fill="{P['navy']}">HEN'S ARCADE</text>
</svg>'''

# ---------- Icons (64x64, 4px navy stroke, flat fills) ----------
S = f'stroke="{P["navy"]}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"'
def icon(body): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">{body}</svg>'
def medal(fill, ribbon, mark=""):
    return icon(f'''<path d="M20 4 L32 26 L44 4" fill="none" stroke="{ribbon}" stroke-width="10"/>
      <circle cx="32" cy="40" r="18" fill="{fill}" {S}/><circle cx="32" cy="40" r="11" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3"/>{mark}''')
ACORN = f'''<path d="M32 28 C44 28 44 44 32 54 C20 44 20 28 32 28Z" fill="{P['gold']}" {S}/>
            <path d="M21 32 C21 22 43 22 43 32Z" fill="{P['orange_d']}" {S}/><path d="M32 22 L34 16" {S}/>'''
ICONS = {
    "timer":      icon(f'<circle cx="32" cy="36" r="22" fill="{P["cream"]}" {S}/><path d="M26 6h12M32 6v8M32 36 L42 26" {S} fill="none"/><path d="M50 16 l4-4" {S}/>'),
    "checkpoint": icon(f'<path d="M14 58 V6" {S}/><path d="M16 8 H50 L42 20 L50 32 H16Z" fill="{P["glass"]}" {S}/>'),
    "goal":       icon(f'<path d="M14 58 V6" {S}/><path d="M16 8 H52 V32 H16Z" fill="#fff" {S}/><path d="M16 8h9v8h-9zM34 8h9v8h-9zM25 16h9v8h-9zM43 16h9v8h-9zM16 24h9v8h-9zM34 24h9v8h-9z" fill="{P["navy"]}"/>'),
    "bonus_time": icon(f'<circle cx="32" cy="32" r="24" fill="{P["lime"]}" {S}/><path d="M22 32h20M32 22v20" {S} stroke-width="6"/>'),
    "ball":       icon(f'<circle cx="32" cy="32" r="26" fill="{P["glass"]}" fill-opacity=".45" {S}/><path d="M8 34 Q32 42 56 34" {S} fill="none"/><path d="M18 18 Q24 11 32 10" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none"/>'),
    "fall":       icon(f'<circle cx="32" cy="22" r="14" fill="{P["glass"]}" fill-opacity=".45" {S}/><path d="M20 44 l-4 10 M32 42 v12 M44 44 l4 10" {S} fill="none"/>'),
    "pause":      icon(f'<rect x="16" y="12" width="11" height="40" rx="3" fill="{P["cream"]}" {S}/><rect x="37" y="12" width="11" height="40" rx="3" fill="{P["cream"]}" {S}/>'),
    "restart":    icon(f'<path d="M50 32 A18 18 0 1 1 44 18" fill="none" {S} stroke-width="6"/><path d="M40 8 L48 18 L36 22Z" fill="{P["navy"]}"/>'),
    "sound_on":   icon(f'<path d="M10 24h10l14-12v40L20 40H10Z" fill="{P["cream"]}" {S}/><path d="M42 24 q6 8 0 16 M48 18 q12 14 0 28" fill="none" {S}/>'),
    "sound_off":  icon(f'<path d="M10 24h10l14-12v40L20 40H10Z" fill="{P["cream"]}" {S}/><path d="M42 24l14 16M56 24L42 40" {S}/>'),
    "keys":       icon(''.join(f'<rect x="{x}" y="{y}" width="16" height="16" rx="3" fill="{P["cream"]}" {S}/>' for x, y in ((24, 10), (6, 30), (24, 30), (42, 30)))),
    "trophy":     icon(f'<path d="M18 8h28v14a14 14 0 0 1-28 0Z" fill="{P["gold"]}" {S}/><path d="M18 12H8q0 14 12 14M46 12h10q0 14-12 14" fill="none" {S}/><path d="M32 36v10M22 56h20l-3-10H25Z" fill="{P["gold"]}" {S}/>'),
    "lang":       icon(f'<circle cx="32" cy="32" r="24" fill="{P["glass"]}" fill-opacity=".4" {S}/><path d="M8 32h48M32 8c-10 12-10 36 0 48M32 8c10 12 10 36 0 48" fill="none" {S}/>'),
    "medal_bronze": medal("#D08A4E", P["magenta"]),
    "medal_silver": medal("#C9D3DE", P["glass"]),
    "medal_gold":   medal(P["gold"], P["lime"]),
    "medal_acorn":  icon(f'<path d="M20 4 L32 26 L44 4" fill="none" stroke="{P["magenta"]}" stroke-width="10"/><circle cx="32" cy="40" r="20" fill="{P["navy"]}" {S}/><g transform="translate(0 -1)">{ACORN.replace("M32 22 L34 16", "M32 22 L34 18")}</g>'),
}

async def render(jobs):
    faces = "".join(f"@font-face{{font-family:Rubik;font-weight:{w};src:url(data:font/woff2;base64,{base64.b64encode((FONTS/f'rubik-latin-{w}-normal.woff2').read_bytes()).decode()})}}" for w in (800, 900))
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(device_scale_factor=1)
        for svg, out, w, h in jobs:
            await pg.set_viewport_size({"width": w, "height": h})
            await pg.set_content(f"<style>{faces}html,body{{margin:0;background:transparent}}svg{{width:{w}px;height:{h}px;display:block}}</style>{svg}")
            await pg.evaluate("document.fonts.ready"); await pg.wait_for_timeout(50)
            await pg.screenshot(path=str(out), omit_background=True)
        await b.close()

if __name__ == "__main__":
    jobs = []
    def put(name, svg, w, h, folder=UI):
        (folder/f"{name}.svg").write_text(svg, encoding="utf-8"); jobs.append((svg, folder/f"{name}.png", w, h))
    put("logo", LOGO, 1800, 600)
    put("pitzi_idle", plain(hamster()), 512, 512)
    put("pitzi_happy", plain(hamster("happy")), 512, 512)
    put("pitzi_dizzy", plain(hamster("dizzy", STARS)), 512, 512)
    put("pitzi_in_ball", ball_wrap(hamster()), 512, 512)
    put("favicon", ball_wrap(hamster("happy")), 128, 128)
    for k, v in ICONS.items(): put(k, v, 128, 128, IC)
    asyncio.run(render(jobs)); print("rendered", len(jobs))

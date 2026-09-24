"""Synthesized SFX + music loop (44.1 kHz, 16-bit mono WAV). Run: python3 tools/make_sfx.py"""
import numpy as np, wave
from pathlib import Path

SR = 44100
OUT = Path(__file__).resolve().parent.parent / "assets/sfx"; OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(3)

def t(d): return np.arange(int(SR*d)) / SR
def env(n, a=0.005, r=None, curve=4.0):
    x = np.linspace(0, 1, n); e = np.exp(-curve * x) if r is None else np.clip(1 - x, 0, 1) ** curve
    k = max(1, int(a*SR)); e[:k] *= np.linspace(0, 1, k); return e
def sweep(f0, f1, d, shape=np.sin):
    f = np.geomspace(f0, f1, int(SR*d)); return shape(2*np.pi*np.cumsum(f)/SR)
def sq(ph): return np.sign(np.sin(ph))
def tri(ph): return 2/np.pi*np.arcsin(np.sin(ph))
def lp(x, a):  # one-pole low-pass, a in (0,1): smaller = darker
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x): acc += a*(v - acc); y[i] = acc
    return y
def noise(d): return rng.uniform(-1, 1, int(SR*d))
def bell(f, d, decay=5):
    tt = t(d); return sum(a*np.sin(2*np.pi*f*m*tt) for m, a in ((1, 1), (2.01, .4), (3.03, .2))) * np.exp(-decay*tt)
def at(x, s, N):
    y = np.zeros(N); e = min(N, s+len(x)); y[s:e] = x[:e-s]; return y
def cat(*xs): return np.concatenate(xs)
def mix(*xs):
    n = max(len(x) for x in xs); out = np.zeros(n)
    for x in xs: out[:len(x)] += x
    return out
def save(name, x, peak=0.85):
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    with wave.open(str(OUT/f"{name}.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x*32767).astype(np.int16).tobytes())

def seamless(x, xf=0.3):
    k = int(SR*xf); head, body, tail = x[:k], x[k:-k], x[-k:]
    fade = np.linspace(0, 1, k); return cat(body, tail*(1-fade) + head*fade)

def build():
    # rolling on plastic floor: low rumble + filtered grit, loop; engine sets playbackRate/volume from speed
    d = 2.6; tt = t(d)
    rumble = lp(noise(d), 0.02) * 3 + 0.3*np.sin(2*np.pi*55*tt) * (0.6 + 0.4*np.sin(2*np.pi*3*tt))
    grit = lp(noise(d), 0.25) * 0.25 * (0.5 + 0.5*np.abs(np.sin(2*np.pi*6*tt)))
    save("roll_loop", seamless(rumble + grit), 0.6)
    save("bump", mix(sweep(140, 55, .18)*env(int(SR*.18), curve=8), lp(noise(.03), .5)*env(int(SR*.03))*.6))
    save("bumper", sweep(260, 900, .32)*(1+.3*np.sin(2*np.pi*28*t(.32)))*env(int(SR*.32), curve=3.5))
    save("fall_whoosh", lp(noise(1.1), .08)*np.sin(np.linspace(0, np.pi, int(SR*1.1)))**2 + .3*sweep(900, 150, 1.1)*env(int(SR*1.1), r=1, curve=1.5))
    pings = sum(at(bell(rng.uniform(2200, 6500), .35, 14), s, int(SR*.9)) for s in rng.integers(0, int(SR*.25), 22))
    save("ball_crack", mix(pings*.5, lp(noise(.4), .6)*env(int(SR*.4), curve=10)))
    save("respawn_pop", cat(lp(noise(.03), .7)*env(int(SR*.03)), *[bell(f, .09, 20) for f in (523, 659, 784, 1047)]))
    save("checkpoint", mix(bell(880, .8, 5), np.pad(bell(1320, .7, 5), (int(SR*.1), 0))))
    save("time_bonus", cat(*[sq(2*np.pi*f*t(.06))*.4*env(int(SR*.06), curve=2) for f in (988, 1319, 1568, 1976)], bell(2637, .4, 8)*.5))
    save("countdown_beep", sq(2*np.pi*660*t(.16))*env(int(SR*.16), curve=2)*.5)
    save("go", sq(2*np.pi*990*t(.5))*env(int(SR*.5), curve=3)*.5 + bell(1980, .5, 6)*.3)
    save("tick", lp(noise(.04), .9)*env(int(SR*.04), curve=12) + np.sin(2*np.pi*1800*t(.04))*env(int(SR*.04), curve=18))
    notes = (523, 659, 784, 1047, 784, 1047)
    fan = cat(*[(sq(2*np.pi*f*t(.12))*.35 + tri(2*np.pi*f/2*t(.12))*.4)*env(int(SR*.12), curve=1.5) for f in notes[:-1]])
    save("goal_fanfare", cat(fan, (tri(2*np.pi*1047*t(.9))*.5 + sq(2*np.pi*523*t(.9))*.25)*env(int(SR*.9), curve=2.5)))
    save("launcher", mix(sweep(120, 70, .35, sq)*env(int(SR*.35), curve=6)*.4, lp(noise(.6), .15)*np.sin(np.linspace(0, np.pi, int(SR*.6)))*1.2))
    d = 2.0; save("vacuum_loop", seamless(lp(noise(d+.3), .05)*2 + .4*np.sin(2*np.pi*110*t(d+.3))*(1+.2*np.sin(2*np.pi*5*t(d+.3)))), .5)
    save("dizzy", sweep(900, 300, .7)*(1+.5*np.sin(2*np.pi*9*t(.7)))*env(int(SR*.7), r=1, curve=1.2))
    tt = t(.18); save("squeak", np.sin(2*np.pi*np.cumsum(2400 + 700*np.sin(np.pi*tt/.18))/SR)*env(len(tt), curve=3)*.6)
    save("ui_click", np.sin(2*np.pi*1400*t(.05))*env(int(SR*.05), curve=14))
    save("ui_hover", np.sin(2*np.pi*2200*t(.03))*env(int(SR*.03), curve=10)*.4)
    save("medal", cat(*[bell(f, .16, 9) for f in (784, 988, 1175)], bell(1568, 1.0, 3)))
    save("saw_loop", seamless((sq(2*np.pi*190*t(1.3))*.3 + lp(noise(1.3), .5)*.3)*(1+.3*np.sin(2*np.pi*14*t(1.3))), .2), .5)
    save("hammer_slam", mix(sweep(90, 40, .3)*env(int(SR*.3), curve=7), lp(noise(.12), .3)*env(int(SR*.12), curve=9)))
    save("tile_crumble", sum(at(lp(noise(.05), .3)*env(int(SR*.05), curve=10), s, int(SR*.6)) for s in rng.integers(0, int(SR*.5), 14)))

def music():
    bpm = 124; beat = 60/bpm; bars = 8; spb = 4
    n = int(SR*beat*spb*bars); out = np.zeros(n)
    def place(x, at):
        s = int(at*SR); e = min(n, s+len(x)); out[s:e] += x[:e-s]
    chords = [(261.6, 329.6, 392.0), (220.0, 261.6, 329.6), (174.6, 220.0, 261.6), (196.0, 246.9, 293.7)]  # C Am F G
    pent = [523.3, 587.3, 659.3, 784.0, 880.0, 1046.5]
    mel_rng = np.random.default_rng(11); motif = mel_rng.integers(0, len(pent), 16)
    for bar in range(bars):
        ch = chords[bar % 4]; b0 = bar*spb*beat
        for q in range(8):  # eighth-note bass
            f = ch[0]/2 * (2 if q % 4 == 3 else 1); place(sq(2*np.pi*f*t(beat/2*.9))*.16*env(int(SR*beat/2*.9), curve=3), b0 + q*beat/2)
        for q in range(4):  # arp pad
            place(tri(2*np.pi*ch[q % 3]*t(beat*.9))*.10*env(int(SR*beat*.9), curve=2), b0 + q*beat)
        for q in range(8):  # hats + kick
            place(lp(noise(.03), .95)*env(int(SR*.03), curve=10)*.08, b0 + q*beat/2 + beat/4)
            if q % 2 == 0: place(sweep(120, 45, .15)*env(int(SR*.15), curve=6)*.35, b0 + q*beat/2)
        if bar % 2 == 1 or bar >= 4:  # lead motif
            for i in range(8):
                f = pent[motif[(bar*8 + i) % 16]]
                if (i + bar) % 3 == 2: continue
                place((sq(2*np.pi*f*t(beat/2*.8))*.07 + tri(2*np.pi*f*t(beat/2*.8))*.1)*env(int(SR*beat/2*.8), curve=2.5), b0 + i*beat/2)
    save("music_loop", out, 0.7)

if __name__ == "__main__":
    build(); music(); print(len(list(OUT.glob('*.wav'))), "wav files")

"""Generate Istiqamah's original reminder sounds (soft bell tones) as WAV files.

Usage: python3 tools/make_sounds.py web/sounds
"""
import math
import os
import struct
import sys
import wave

SR = 44100


def render(notes, dur, gain=0.55):
    n = int(dur * SR)
    buf = [0.0] * n
    for freq, t0, amp, decay in notes:
        s0 = int(t0 * SR)
        w = 2 * math.pi * freq / SR
        for i in range(s0, n):
            k = i - s0
            t = k / SR
            env = math.exp(-t * decay)
            if env < 1e-4:
                break
            attack = min(1.0, t / 0.006)
            v = (math.sin(w * k)
                 + 0.32 * math.sin(2.0 * w * k) * math.exp(-t * decay * 0.8)
                 + 0.12 * math.sin(3.01 * w * k) * math.exp(-t * decay * 1.6)
                 + 0.05 * math.sin(4.2 * w * k) * math.exp(-t * decay * 2.5))
            buf[i] += amp * env * attack * v
    peak = max(1e-9, max(abs(x) for x in buf))
    fade = int(0.08 * SR)
    out = []
    for i, x in enumerate(buf):
        y = x / peak * gain
        if i > n - fade:
            y *= (n - i) / fade
        out.append(int(max(-1.0, min(1.0, y)) * 32767))
    return out


def write(path, samples):
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(b"".join(struct.pack("<h", s) for s in samples))


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "web/sounds"
    os.makedirs(out, exist_ok=True)
    # Calm rising bell: G4, B4, D5, then a soft G5.
    chime = render([(392.0, 0.0, 1.0, 1.25), (493.88, 0.45, 0.9, 1.3),
                    (587.33, 0.9, 0.9, 1.2), (783.99, 1.4, 0.5, 1.5)], 4.6)
    write(os.path.join(out, "chime.wav"), chime)
    # Single gentle ding for reminders.
    soft = render([(880.0, 0.0, 1.0, 2.6), (1318.5, 0.12, 0.4, 3.0)], 1.9, gain=0.42)
    write(os.path.join(out, "soft.wav"), soft)
    # Tones for the sunnah times, each recognisable on its own.
    # Ishraq: a bright rising run, like the sun clearing the horizon.
    write(os.path.join(out, "ishraq.wav"), render([(523.25, 0.0, 0.8, 1.8), (659.25, 0.22, 0.8, 1.8),
                                                    (783.99, 0.44, 0.85, 1.6), (1046.5, 0.7, 0.7, 1.4)], 3.6, gain=0.5))
    # Duha: two warm, open notes.
    write(os.path.join(out, "duha.wav"), render([(440.0, 0.0, 1.0, 1.1), (659.25, 0.5, 0.85, 1.1)], 3.8, gain=0.5))
    # Last third of the night: low and slow, gentle enough for the small hours.
    write(os.path.join(out, "night.wav"), render([(293.66, 0.0, 1.0, 0.8), (440.0, 0.9, 0.7, 0.8)], 5.0, gain=0.45))
    # Dua times: a single bell with a soft shimmer above it.
    write(os.path.join(out, "dua.wav"), render([(659.25, 0.0, 1.0, 1.2), (987.77, 0.06, 0.45, 1.6),
                                                 (1318.5, 0.12, 0.25, 2.0)], 3.6, gain=0.48))
    print("sounds written to", out)


if __name__ == "__main__":
    main()

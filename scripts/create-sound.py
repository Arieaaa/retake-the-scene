import math
import random
import struct
import wave
from pathlib import Path

random.seed(19)
rate = 22050
frames = []
last = 0.0
for i in range(rate):
    t = i / rate
    envelope = min(t / 0.06, 1) * max(0, 1 - t) ** 1.4
    noise = random.uniform(-1, 1)
    high = noise - last * 0.8
    last = noise
    sample = (high * 0.55 + math.sin(2 * math.pi * 143 * t) * 0.03) * envelope
    frames.append(struct.pack('<h', int(sample * 12000)))
with wave.open(str(Path(__file__).resolve().parents[1] / 'public/sound/cat-hiss.wav'), 'wb') as out:
    out.setnchannels(1)
    out.setsampwidth(2)
    out.setframerate(rate)
    out.writeframes(b''.join(frames))
print('Created original synthesized cat-hiss.wav: 1 second, mono, 22050Hz')

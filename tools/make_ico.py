"""Pack PNG icons into a Windows .ico (PNG-compressed entries, Windows Vista and later).
Usage: python3 tools/make_ico.py out.ico icon16.png icon32.png ... (largest last)"""
import struct, sys
from pathlib import Path
out, pngs = sys.argv[1], sys.argv[2:]
entries, data = [], b""
offset = 6 + 16 * len(pngs)
for p in pngs:
    b = Path(p).read_bytes()
    w, h = struct.unpack(">II", b[16:24])
    entries.append(struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(b), offset + len(data)))
    data += b
Path(out).write_bytes(struct.pack("<HHH", 0, 1, len(pngs)) + b"".join(entries) + data)
print("wrote", out, len(pngs), "sizes")

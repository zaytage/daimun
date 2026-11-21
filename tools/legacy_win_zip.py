"""Zip the Windows build with Daimun.exe named Istiqamah.exe, for apps from before the rename (their updater looks for that name)."""
import os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(root):
        for f in files:
            full = os.path.join(d, f)
            rel = os.path.relpath(full, root)
            base = os.path.basename(rel)
            if base.startswith("Daimun.exe"):
                rel = os.path.join(os.path.dirname(rel), "Istiqamah.exe" + base[len("Daimun.exe"):])
            z.write(full, rel)

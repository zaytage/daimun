"""Turn web/index.html into the page body a claude.ai Artifact expects.

The Artifact host wraps the page in its own <!doctype>/<head>/<body>, so this keeps the
title, adds the side-gutter meta, links the same stylesheet and copies the body as-is.
Usage: python3 tools/make_artifact_page.py web/index.html artifact/index.html
"""
import os
import re
import sys

src = sys.argv[1] if len(sys.argv) > 1 else "web/index.html"
dst = sys.argv[2] if len(sys.argv) > 2 else "artifact/index.html"

html = open(src, encoding="utf-8").read()
title = re.search(r"<title>(.*?)</title>", html, re.S).group(1).strip()
body = re.search(r"<body[^>]*>(.*)</body>", html, re.S).group(1).strip("\n")

page = (
    f"<title>{title}</title>\n"
    '<meta name="claude:viewport-fit-sides" content="cover">\n'
    '<link rel="stylesheet" href="styles.css">\n'
    f"{body}\n"
)
os.makedirs(os.path.dirname(dst), exist_ok=True)
open(dst, "w", encoding="utf-8").write(page)
print("wrote", dst)

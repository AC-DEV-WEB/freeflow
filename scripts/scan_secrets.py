"""Before a release: look for personal data in a folder (the built app, the repo).

    python scripts/scan_secrets.py release/FreeFlow-win32-x64 [other words to look for...]

Looks for the current user's name and home folder (UTF-8 and UTF-16), the extra
words given on the command line, and API key shapes (Hugging Face, OpenAI,
Anthropic, GitHub). Exit code 1 when something is found.
"""
import getpass
import os
import re
import sys

home = os.path.expanduser("~")
needles = {getpass.getuser(), home, home.replace("\\", "/"), *sys.argv[2:]}
needles = [n.encode() for n in needles if n and len(n) >= 4]
PATTERNS = [re.compile(rb"hf_[A-Za-z0-9]{30,}"), re.compile(rb"sk-(?:ant-)?[A-Za-z0-9_-]{30,}"),
            re.compile(rb"gh[pousr]_[A-Za-z0-9]{30,}"), re.compile(rb"AKIA[0-9A-Z]{16}")]
SKIP = {".git", "node_modules", "__pycache__"}

hits = 0
for root, dirs, files in os.walk(sys.argv[1]):
    dirs[:] = [d for d in dirs if d not in SKIP]
    for f in files:
        p = os.path.join(root, f)
        try:
            with open(p, "rb") as fh:
                data = fh.read()
        except OSError:
            continue
        for n in needles:
            if n in data or n.decode().encode("utf-16-le") in data:
                print("PERSONAL", n.decode(), "->", p)
                hits += 1
        for r in PATTERNS:
            m = r.search(data)
            if m:
                print("KEY?", m.group(0)[:10].decode(errors="replace") + "...", "->", p)
                hits += 1
print("hits:", hits)
sys.exit(1 if hits else 0)

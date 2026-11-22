"""Add today's download totals to a JSON history file (one entry per day; rerunning the same day replaces it).

New installs are the plain Daimun-mac.zip / Daimun-windows.zip downloads. Apps update from the
*-update.zip and *-legacy.zip copies, so those count as updates.
"""
import datetime, json, os, sys, urllib.request

REPO = "zaytage/daimun"


def kind(name):
    n = name.lower()
    if "update" in n or "legacy" in n:
        return "updates"
    if "mac" in n:
        return "mac"
    if "windows" in n:
        return "windows"
    return None


def totals():
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/releases?per_page=100",
                                 headers={"Accept": "application/vnd.github+json", "User-Agent": "daimun-stats"})
    token = os.environ.get("GH_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    out = {"mac": 0, "windows": 0, "updates": 0}
    for rel in json.load(urllib.request.urlopen(req)):
        for a in rel.get("assets", []):
            k = kind(a["name"])
            if k:
                out[k] += a["download_count"]
    return out


path = sys.argv[1]
try:
    history = json.load(open(path))
except (OSError, ValueError):
    history = []
today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=1))).date().isoformat()  # Lagos date
entry = {"date": today, **totals()}
history = [h for h in history if h.get("date") != today] + [entry]
history.sort(key=lambda h: h["date"])
with open(path, "w") as f:
    json.dump(history, f, indent=1)
print(entry)

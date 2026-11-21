"""Build Istiqamah's Country -> State -> City data from GeoNames (CC BY 4.0, geonames.org).

Writes small JS files (loaded with <script>, so they work from a file, a website or a
claude.ai page alike): places/index.js plus one places/<ISO>.js per country.
Usage: python3 -I tools/build_places.py <geonames dir> web/places
"""
import collections
import io
import json
import os
import sys
import zipfile

src, out = sys.argv[1], sys.argv[2]

# Calculation method commonly used in each country (others use Muslim World League).
METHOD = {
    "MY": "jakim", "SG": "muis", "BN": "muis", "ID": "kemenag",
    "SA": "makkah", "YE": "makkah", "OM": "makkah", "BH": "makkah",
    "AE": "dubai", "QA": "qatar", "KW": "kuwait", "EG": "egypt", "SD": "egypt", "LY": "egypt",
    "TR": "turkey", "PK": "karachi", "IN": "karachi", "BD": "karachi", "AF": "karachi",
    "US": "isna", "CA": "isna",
}

countries = {}
for line in open(os.path.join(src, "countryInfo.txt"), encoding="utf-8"):
    if line.startswith("#") or not line.strip():
        continue
    f = line.rstrip("\n").split("\t")
    countries[f[0]] = f[4]

states = collections.defaultdict(dict)
for line in open(os.path.join(src, "admin1CodesASCII.txt"), encoding="utf-8"):
    code, name = line.rstrip("\n").split("\t")[:2]
    iso, a1 = code.split(".", 1)
    states[iso][a1] = name

cities = collections.defaultdict(list)
tz_count = collections.defaultdict(collections.Counter)
tz_best = {}
with zipfile.ZipFile(os.path.join(src, "cities1000.zip")) as z:
    with z.open("cities1000.txt") as fh:
        for line in io.TextIOWrapper(fh, encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            name, lat, lng, iso, a1, pop, tz = f[1], float(f[4]), float(f[5]), f[8], f[10], int(f[14] or 0), f[17]
            if iso not in countries:
                continue
            cities[iso].append((name, a1, round(lat, 3), round(lng, 3), pop))
            tz_count[tz][iso] += 1
            if tz and (tz not in tz_best or pop > tz_best[tz][2]):
                tz_best[tz] = (iso, name, pop)

os.makedirs(out, exist_ok=True)
index = []
for iso in sorted(cities, key=lambda i: countries[i]):
    rows = sorted(cities[iso], key=lambda r: -r[4])  # most populous first
    used = {r[1] for r in rows}
    st = {a1: states[iso].get(a1) or "Other areas" for a1 in used}
    data = {"s": st, "c": [[r[0], r[1], r[2], r[3]] for r in rows]}
    with open(os.path.join(out, f"{iso}.js"), "w", encoding="utf-8") as fh:
        fh.write(f"IstiqamahPlaces.country({json.dumps(iso)},{json.dumps(data, ensure_ascii=False, separators=(',', ':'))});\n")
    index.append([iso, countries[iso], METHOD.get(iso, "mwl")])

tz = {t: [best[0], best[1]] for t, best in tz_best.items() if tz_count[t][best[0]] == max(tz_count[t].values())}
with open(os.path.join(out, "index.js"), "w", encoding="utf-8") as fh:
    fh.write("IstiqamahPlaces.index(" + json.dumps({"countries": index, "tz": tz}, ensure_ascii=False, separators=(",", ":")) + ");\n")

total = sum(len(v) for v in cities.values())
print(f"{len(index)} countries, {total} places written to {out}")

import csv
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path


source, boundary, output = map(Path, sys.argv[1:4])
output.mkdir(parents=True, exist_ok=True)


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle)


def write_csv(name, columns, rows):
    with (output / name).open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(columns)
        writer.writerows(rows)


def grid_cell(x, y):
    return math.floor(x * 4), math.floor(y * 4)


def ring_contains(ring, x, y):
    inside = False
    x0, y0 = ring[-1]
    for x1, y1 in ring:
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            inside = not inside
        x0, y0 = x1, y1
    return inside


def contains(polygon, x, y):
    shell, *holes = polygon
    return ring_contains(shell, x, y) and not any(ring_contains(hole, x, y) for hole in holes)


features = json.loads(boundary.read_text(encoding="utf-8"))["features"]
grid = defaultdict(list)
districts = {}
for feature in features:
    props, geometry = feature["properties"], feature["geometry"]
    district = str(props["SIG_CD"])
    districts[district] = str(props["CTPRVN_CD"])
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    for polygon in polygons:
        shell = polygon[0]
        xs, ys = zip(*shell)
        bounds = min(xs), min(ys), max(xs), max(ys)
        left, bottom = grid_cell(*bounds[:2])
        right, top = grid_cell(*bounds[2:])
        for i in range(left, right + 1):
            for j in range(bottom, top + 1):
                grid[i, j].append((district, bounds, polygon))


def find_districts(x, y):
    return {
        code for code, (left, bottom, right, top), polygon in grid.get(grid_cell(x, y), ())
        if left <= x <= right and bottom <= y <= top and contains(polygon, x, y)
    }


aliases = {"12": {"29", "46"}, "52": {"45"}}
observations = defaultdict(set)
charger_counts = Counter()
seen_chargers = set()
for row in read_csv(source / "ev_charger_info.csv"):
    station, charger = row["statId"].strip(), row["chgerId"].strip()
    assert station and charger and (station, charger) not in seen_chargers, (station, charger)
    seen_chargers.add((station, charger))
    observations[station].add((row["zcode"].strip(), row["zscode"].strip(), float(row["lng"]), float(row["lat"])))
    charger_counts[station] += 1

station_map = []
summary = Counter()
counts = Counter()
for station, variants in sorted(observations.items()):
    codes = {(sido, sig) for sido, sig, _, _ in variants}
    raw_sido, raw_sig = sorted(codes)[0] if len(codes) == 1 else ("", "")
    map_sig = ""
    if len(codes) != 1:
        method = "review_conflicting_source_codes"
    else:
        allowed = aliases.get(raw_sido, {raw_sido})
        observed = [find_districts(x, y) for _, _, x, y in sorted(variants)]
        if any(not matches for matches in observed):
            method = "review_outside_boundary"
        elif any(len(matches) != 1 for matches in observed):
            method = "review_overlapping_boundaries"
        elif len(set.union(*observed)) != 1:
            method = "review_conflicting_coordinates"
        else:
            candidate, = observed[0]
            if districts[candidate] not in allowed:
                method = "review_sido_conflict"
            elif raw_sig in districts and raw_sig != candidate:
                method = "review_sigungu_conflict"
            else:
                map_sig = candidate
                method = "code_and_coordinate" if raw_sig == map_sig else "coordinate_in_source_sido"
    map_sido = districts.get(map_sig, "")
    station_map.append((station, raw_sido, raw_sig, map_sido, map_sig, method))
    summary[(raw_sido, raw_sig, map_sido, map_sig, method)] += 1
    counts[method] += charger_counts[station]

assert len(station_map) == len(observations)
assert sum(counts.values()) == len(seen_chargers)
assert all(not s[4] or districts[s[4]] == s[3] for s in station_map)
write_csv("station_region_map.csv",
          ["stat_id", "source_sido_code", "source_sigungu_code", "svg_sido_code", "svg_sigungu_code", "match_method"],
          station_map)
write_csv("charger_region_code_map.csv",
          ["source_sido_code", "source_sigungu_code", "svg_sido_code", "svg_sigungu_code", "match_method", "station_count"],
          [(*key, count) for key, count in sorted(summary.items())])

# A registration group can cover multiple polygons. Aggregate and display it once.
registration = {
    "서울": ("11", ("11",)), "부산": ("26", ("26",)), "대구": ("27", ("27",)),
    "인천": ("28", ("28",)), "광주": ("29", ("29",)), "대전": ("30", ("30",)),
    "울산": ("31", ("31",)), "세종": ("36", ("36",)), "경기": ("41", ("41",)),
    "강원": ("51", ("51",)), "충북": ("43", ("43",)), "충남": ("44", ("44",)),
    "전북": ("52", ("45",)), "전남": ("46", ("46",)), "경북": ("47", ("47",)),
    "경남": ("48", ("48",)), "제주": ("50", ("50",)),
    "전남광주": ("12", ("29", "46")),
}
periods = defaultdict(set)
period_regions = defaultdict(set)
for row in read_csv(source / "ev_registrations_by_sido_monthly.csv"):
    name, month = row["region_name"], row["report_month"]
    assert month not in periods[name], (name, month)
    periods[name].add(month)
    period_regions[month].add(name)
assert set(periods) == set(registration)
for names in period_regions.values():
    members = [code for name in names for code in registration[name][1]]
    assert len(members) == len(set(members)) == len(set(districts.values()))
write_csv("registration_region_map.csv",
          ["source_region_name", "aggregate_region_code", "svg_sido_code", "first_observed_month", "last_observed_month"],
          [(name, code, member, min(periods[name]), max(periods[name]))
           for name, (code, members) in registration.items() for member in members])
print("station_methods", dict(Counter(row[-1] for row in station_map)))
print("charger_methods", dict(counts))
print("total", len(station_map), len(seen_chargers), len(summary))

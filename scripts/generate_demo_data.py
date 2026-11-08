"""Build deterministic fictional sample rows from the bundled boundaries."""

from __future__ import annotations

import csv
import hashlib
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.geo_utils import point_in_geometry, representative_point  # noqa: E402


def seeded(text: str) -> random.Random:
    return random.Random(int(hashlib.sha256(text.encode()).hexdigest()[:12], 16))


def write_csv(path: Path, fields: list[str], rows: list[dict]):
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main():
    data = ROOT / "data/demo"
    geo = ROOT / "data/geo"
    sido_geo = json.loads((geo / "ctprvn.geojson").read_text(encoding="utf-8"))
    sig_geo = json.loads((geo / "sig.geojson").read_text(encoding="utf-8"))
    sido_rows, sig_rows, station_rows = [], [], []
    sig_by_sido: dict[str, list[dict]] = {}
    for feature in sig_geo["features"]:
        sig_by_sido.setdefault(str(feature["properties"]["CTPRVN_CD"]), []).append(feature)

    for s_feature in sido_geo["features"]:
        p = s_feature["properties"]
        sido_code, sido_name = str(p["CTPRVN_CD"]), p["CTP_KOR_NM"]
        rng = seeded(sido_code)
        ev = rng.randint(35_000, 310_000)
        fast, slow = rng.randint(450, 2600), rng.randint(2200, 15000)
        sido_rows.append({"sido_code": sido_code, "sido_name": sido_name, "ev_count": ev, "fast_chargers": fast, "slow_chargers": slow})
        children = sig_by_sido.get(sido_code, [])
        weights = [seeded(str(f["properties"]["SIG_CD"])).uniform(.6, 1.7) for f in children]
        total_w = sum(weights)
        for feature, weight in zip(children, weights):
            q = feature["properties"]
            code, name = str(q["SIG_CD"]), q["SIG_KOR_NM"]
            rr = seeded(code)
            child_ev = max(150, round(ev * weight / total_w))
            child_fast = max(3, round(fast * weight / total_w * rr.uniform(.7, 1.25)))
            child_slow = max(10, round(slow * weight / total_w * rr.uniform(.7, 1.25)))
            sig_rows.append({"sido_code": sido_code, "sigungu_code": code, "sigungu_name": name, "ev_count": child_ev, "fast_chargers": child_fast, "slow_chargers": child_slow})
            lng, lat = representative_point(feature["geometry"])
            station_count = min(5, max(2, round((child_fast + child_slow) / 120)))
            for index in range(station_count):
                station_lng, station_lat = lng, lat
                for _ in range(20):
                    candidate = (lng + rr.uniform(-.012, .012), lat + rr.uniform(-.012, .012))
                    if point_in_geometry(*candidate, feature["geometry"]):
                        station_lng, station_lat = candidate
                        break
                fast_total, slow_total = rr.randint(1, 8), rr.randint(3, 18)
                station_rows.append({
                    "station_id": f"S-{code}-{index+1:02d}", "sigungu_code": code,
                    "station_name": f"{name} {['생활권','공영주차장','환승센터','행정복지센터','체육공원'][index]} 충전소",
                    "address": f"{sido_name} {name} 샘플로 {index + 1}",
                    "lat": round(station_lat, 6), "lng": round(station_lng, 6),
                    "fast_total": fast_total, "fast_available": rr.randint(0, fast_total),
                    "slow_total": slow_total, "slow_available": rr.randint(0, slow_total),
                    "operator": rr.choice(["환경부(샘플)", "한국전력(샘플)", "민간 CPO(샘플)"]),
                    "hours": rr.choice(["24시간", "06:00–23:00", "평일 09:00–18:00"]),
                    "updated_at": "샘플 기준 2026-10-31 12:00",
                })

    write_csv(data / "sido_metrics.csv", list(sido_rows[0]), sido_rows)
    write_csv(data / "sigungu_metrics.csv", list(sig_rows[0]), sig_rows)
    write_csv(data / "stations.csv", list(station_rows[0]), station_rows)
    print(f"generated: {len(sido_rows)} sido, {len(sig_rows)} sigungu, {len(station_rows)} stations")


if __name__ == "__main__":
    main()

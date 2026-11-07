import json
from pathlib import Path

import pandas as pd

from data_provider import SampleCsvProvider
from geo_utils import point_in_geometry, representative_point


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def test_boundary_counts_and_click_points():
    sido, sig = load("ctprvn.geojson"), load("sig.geojson")
    assert len(sido["features"]) == 17
    assert len(sig["features"]) == 250
    for feature in sido["features"] + sig["features"]:
        assert point_in_geometry(*representative_point(feature["geometry"]), feature["geometry"])


def test_sample_data_matches_boundaries_and_is_valid():
    store = SampleCsvProvider(DATA)
    sido, sig = load("ctprvn.geojson"), load("sig.geojson")
    sido_codes = {str(f["properties"]["CTPRVN_CD"]) for f in sido["features"]}
    sig_by_code = {str(f["properties"]["SIG_CD"]): f for f in sig["features"]}
    assert set(store.sido_metrics().sido_code) == sido_codes
    all_sig = pd.concat([store.sigungu_metrics(code) for code in sido_codes])
    assert set(all_sig.sigungu_code) == set(sig_by_code)
    stations = pd.read_csv(DATA / "stations.csv", dtype={"sigungu_code": str})
    assert stations.fast_available.le(stations.fast_total).all()
    assert stations.slow_available.le(stations.slow_total).all()
    assert all(
        point_in_geometry(float(row.lng), float(row.lat), sig_by_code[row.sigungu_code]["geometry"])
        for row in stations.itertuples()
    )

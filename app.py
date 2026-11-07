"""Streamlit shell. All map interaction stays inside the persistent browser view."""
import json
import os
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

from data_provider import SampleCsvProvider
from map_assets import project
from geocoding import AddressSearchError, search_addresses

ROOT = Path(__file__).parent
st.set_page_config(page_title="EV 충전 인프라 지도", page_icon="⚡", layout="wide", initial_sidebar_state="collapsed")
st.markdown("<style>.block-container{max-width:1600px;padding:0.5rem 1rem}header[data-testid=stHeader]{display:none!important}iframe{border:0}</style>", unsafe_allow_html=True)


@st.cache_data
def load_payload(version):
    maps = json.loads((ROOT / "assets/maps.json").read_text(encoding="utf-8"))
    store = SampleCsvProvider(ROOT / "data")  # Replace with your API/DB provider.
    sido = store.sido_metrics().to_dict("records")
    sigungu, stations = [], []
    for row in sido:
        children = store.sigungu_metrics(str(row["sido_code"]))
        sigungu.extend(children.to_dict("records"))
        for code in children.sigungu_code:
            stations.extend(store.stations(str(code)).to_dict("records"))
    # User-supplied API example, kept distinct from fictional stations.
    for raw in json.loads((ROOT / "data/raw_station_sample.json").read_text(encoding="utf-8")):
        stations.append({"station_id": raw["statId"], "sigungu_code": raw["zscode"], "station_name": raw["statNm"], "address": raw["addr"], "lat": float(raw["lat"]), "lng": float(raw["lng"]), "operator": raw["busiNm"], "hours": raw["useTime"], "phone": raw["busiCall"], "output_kw": raw["output"], "status_code": raw["stat"], "updated_at": raw["statUpdDt"], "source": "제공된 API 예시 · 실시간 아님"})
    valid = []
    for station in stations:
        try:
            lat, lng = float(station["lat"]), float(station["lng"])
            if not (32 <= lat <= 40 and 123 <= lng <= 133):
                continue
            station["point"] = project(lng, lat)
            station.setdefault("source", "가상 샘플")
            valid.append(station)
        except (TypeError, ValueError, KeyError):
            continue
    return {"maps": maps, "sidoMetrics": sido, "sigunguMetrics": sigungu, "stations": valid}


try:
    api_key = os.environ.get("KAKAO_REST_API_KEY", "") or str(st.secrets.get("KAKAO_REST_API_KEY", ""))
except (FileNotFoundError, st.errors.StreamlitSecretNotFoundError):
    api_key = ""

# Stable component identity preserves the map and bookmarks through address calls.
map_component = components.declare_component("ev_map", path=str(ROOT / "components"))
files = [ROOT / "assets/maps.json", *sorted((ROOT / "data").glob("*.csv")), ROOT / "data/raw_station_sample.json"]
version = tuple((str(path.name), path.stat().st_mtime_ns) for path in files)
payload = load_payload(version)
payload["geocoder"] = {"mode": "kakao" if api_key else "demo", "sampleAddress": "서울특별시 관악구 낙성대로4가길 5"}
request = map_component(payload=payload, response=st.session_state.get("geocode_response"), default=None, key="ev-map-view")
if isinstance(request, dict) and request.get("action") == "geocode":
    request_id = str(request.get("requestId", ""))[:100]
    if request_id and st.session_state.get("last_geocode_request") != request_id:
        st.session_state.last_geocode_request = request_id
        try:
            rows = json.loads((ROOT / "data/raw_station_sample.json").read_text(encoding="utf-8"))
            candidates = search_addresses(request.get("query", ""), api_key, rows)
            response = {"requestId": request_id, "candidates": candidates, "error": ""}
        except AddressSearchError as exc:
            response = {"requestId": request_id, "candidates": [], "error": str(exc)}
        st.session_state.geocode_response = response
        st.rerun()

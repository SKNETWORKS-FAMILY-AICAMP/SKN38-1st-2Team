"""Streamlit shell. All map interaction stays inside the persistent browser view."""
import json
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

from data_provider import SampleCsvProvider
from map_assets import project

ROOT = Path(__file__).parent
st.set_page_config(page_title="EV 충전 인프라 지도", page_icon="⚡", layout="wide", initial_sidebar_state="collapsed")
st.markdown("<style>.block-container{max-width:1600px;padding:0.5rem 1rem}header[data-testid=stHeader]{height:0;background:transparent}iframe{border:0}</style>", unsafe_allow_html=True)


@st.cache_data
def render_app():
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
    payload = {"maps": maps, "sidoMetrics": sido, "sigunguMetrics": sigungu, "stations": valid}
    encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).replace("<", "\\u003c")
    template = (ROOT / "components/map_view.html").read_text(encoding="utf-8")
    return template.replace("/*__CSS__*/", (ROOT / "components/map_view.css").read_text(encoding="utf-8")).replace("/*__DATA__*/", encoded).replace("/*__JS__*/", (ROOT / "components/map_view.js").read_text(encoding="utf-8"))


components.html(render_app(), height=1100, scrolling=True)

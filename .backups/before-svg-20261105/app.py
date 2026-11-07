from __future__ import annotations

import json
from pathlib import Path

import folium
import pandas as pd
import streamlit as st
from branca.colormap import LinearColormap
from streamlit_folium import st_folium

from data_provider import SampleCsvProvider
from geo_utils import bounds, point_in_geometry

ROOT = Path(__file__).parent
DATA = ROOT / "data"

st.set_page_config(page_title="EV 충전 인프라 부담도", page_icon="⚡", layout="wide")
st.markdown("""
<style>
  .stApp { background: #f7f8f6; color: #26332d; }
  .block-container { max-width: 1420px; padding-top: 1.5rem; }
  [data-testid="stMetric"] { background: #fff; border: 1px solid #e4e9e5; border-radius: 16px; padding: 14px 16px; }
  .sample-pill { display:inline-block; padding:5px 10px; border-radius:999px; background:#fff1c9; color:#755900; font-size:.82rem; font-weight:700; }
  .crumb { color:#63726a; font-size:.92rem; margin:.35rem 0 1rem; }
  .station-card { background:#fff; border:1px solid #e1e8e3; border-radius:18px; padding:18px; margin-top:12px; }
</style>
""", unsafe_allow_html=True)


@st.cache_data
def load_geojson(filename: str) -> dict:
    return json.loads((DATA / filename).read_text(encoding="utf-8"))


@st.cache_resource
def provider() -> SampleCsvProvider:
    # Real deployment: replace this with an EVDataProvider implementation.
    return SampleCsvProvider(DATA)


def with_burden(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["effective_chargers"] = out.fast_chargers * 2 + out.slow_chargers
    out["burden"] = out.ev_count / out.effective_chargers.clip(lower=1)
    return out


def metric_lookup(df: pd.DataFrame, key: str) -> dict[str, dict]:
    return {str(row[key]): row.to_dict() for _, row in df.iterrows()}


def color_scale(values: pd.Series) -> LinearColormap:
    low, high = float(values.min()), float(values.max())
    if low == high:
        high = low + 1
    return LinearColormap(["#eef6ee", "#cae1cf", "#8eb9a5", "#557f70", "#2f5148"], vmin=low, vmax=high)


def map_for(features: list[dict], metrics: pd.DataFrame, metric_code: str, geo_code: str, name_field: str, zoom: int) -> tuple[folium.Map, dict]:
    lookup = metric_lookup(metrics, metric_code)
    scale = color_scale(metrics.burden)
    min_lng, min_lat, max_lng, max_lat = bounds(features)
    fmap = folium.Map(
        location=[(min_lat + max_lat) / 2, (min_lng + max_lng) / 2],
        zoom_start=zoom, tiles=None, control_scale=True,
        zoom_control=True, prefer_canvas=False,
    )

    def style(feature):
        code = str(feature["properties"][geo_code])
        value = lookup.get(code, {}).get("burden", scale.vmin)
        return {"fillColor": scale(value), "color": "#ffffff", "weight": 1.8, "fillOpacity": .88}

    def highlight(_feature):
        return {"weight": 3, "color": "#263f37", "fillOpacity": .96}

    # Put display fields into a copy so the tooltip never depends on JavaScript joins.
    collection = {"type": "FeatureCollection", "features": []}
    for feature in features:
        copied = json.loads(json.dumps(feature))
        code = str(copied["properties"][geo_code])
        row = lookup.get(code, {})
        copied["properties"]["display_name"] = copied["properties"].get(name_field, "")
        copied["properties"]["burden_label"] = f"{row.get('burden', 0):.1f}대 / 환산충전기"
        copied["properties"]["ev_label"] = f"{int(row.get('ev_count', 0)):,}대"
        collection["features"].append(copied)

    folium.GeoJson(
        collection, style_function=style, highlight_function=highlight, smooth_factor=1.2,
        tooltip=folium.GeoJsonTooltip(
            fields=["display_name", "burden_label", "ev_label"],
            aliases=["지역", "인프라 부담도", "전기차"], sticky=False,
            style="background:#fff;border:0;border-radius:10px;padding:10px;box-shadow:0 4px 18px #0002;",
        ),
    ).add_to(fmap)
    scale.caption = "인프라 부담도 (전기차 대수 ÷ 환산 충전기)"
    scale.add_to(fmap)
    fmap.fit_bounds([[min_lat, min_lng], [max_lat, max_lng]], padding=(12, 12))
    return fmap, lookup


def selected_feature(click: dict | None, features: list[dict]) -> dict | None:
    if not click:
        return None
    lng, lat = click.get("lng"), click.get("lat")
    if lng is None or lat is None:
        return None
    return next((f for f in features if point_in_geometry(float(lng), float(lat), f["geometry"])), None)


def reset(level="sido"):
    st.session_state.level = level
    if level == "sido":
        st.session_state.pop("sido", None)
        st.session_state.pop("sigungu", None)
    elif level == "sigungu":
        st.session_state.pop("sigungu", None)


st.session_state.setdefault("level", "sido")
sido_geo, sig_geo = load_geojson("ctprvn.geojson"), load_geojson("sig.geojson")
store = provider()

head_a, head_b = st.columns([5, 1])
with head_a:
    st.title("전국 전기차 충전 인프라 부담도")
    st.caption("전기차 등록 대수와 충전 인프라를 한눈에 보고, 지역별 충전소까지 탐색합니다.")
with head_b:
    st.markdown('<div class="sample-pill">● SAMPLE DATA</div>', unsafe_allow_html=True)
    st.caption("수치는 모두 가상 데이터입니다.")

level = st.session_state.level
if level == "sido":
    metrics = with_burden(store.sido_metrics())
    total = metrics[["ev_count", "fast_chargers", "slow_chargers"]].sum()
    a, b, c, d = st.columns(4)
    a.metric("전국 전기차", f"{total.ev_count:,.0f}대")
    b.metric("급속 충전기", f"{total.fast_chargers:,.0f}기")
    c.metric("완속 충전기", f"{total.slow_chargers:,.0f}기")
    d.metric("평균 부담도", f"{total.ev_count / (total.fast_chargers * 2 + total.slow_chargers):.1f}대")
    st.markdown('<div class="crumb">전국  ›  <b>시·도를 지도에서 선택하세요</b></div>', unsafe_allow_html=True)
    features = sido_geo["features"]
    fmap, _ = map_for(features, metrics, "sido_code", "CTPRVN_CD", "CTP_KOR_NM", 7)
    result = st_folium(fmap, height=650, use_container_width=True, returned_objects=["last_clicked"], key="sido-map")
    picked = selected_feature(result.get("last_clicked"), features)
    if picked:
        st.session_state.sido = str(picked["properties"]["CTPRVN_CD"])
        st.session_state.level = "sigungu"
        st.rerun()

elif level == "sigungu":
    sido_code = st.session_state.sido
    sido_row = store.sido_metrics().loc[lambda x: x.sido_code == sido_code].iloc[0]
    metrics = with_burden(store.sigungu_metrics(sido_code))
    if st.button("← 전국으로"):
        reset("sido"); st.rerun()
    st.subheader(f"{sido_row.sido_name} 시·군·구별 부담도")
    st.markdown(f'<div class="crumb">전국  ›  {sido_row.sido_name}  ›  <b>시·군·구를 선택하세요</b></div>', unsafe_allow_html=True)
    features = [f for f in sig_geo["features"] if str(f["properties"]["CTPRVN_CD"]) == sido_code]
    fmap, _ = map_for(features, metrics, "sigungu_code", "SIG_CD", "SIG_KOR_NM", 9)
    result = st_folium(fmap, height=650, use_container_width=True, returned_objects=["last_clicked"], key=f"sig-map-{sido_code}")
    picked = selected_feature(result.get("last_clicked"), features)
    if picked:
        st.session_state.sigungu = str(picked["properties"]["SIG_CD"])
        st.session_state.level = "stations"
        st.rerun()

else:
    sido_code, sigungu_code = st.session_state.sido, st.session_state.sigungu
    sido_row = store.sido_metrics().loc[lambda x: x.sido_code == sido_code].iloc[0]
    sig_row = with_burden(store.sigungu_metrics(sido_code)).loc[lambda x: x.sigungu_code == sigungu_code].iloc[0]
    stations = store.stations(sigungu_code)
    if st.button(f"← {sido_row.sido_name} 시·군·구"):
        reset("sigungu"); st.rerun()
    st.subheader(f"{sido_row.sido_name} {sig_row.sigungu_name} 충전소")
    st.markdown(f'<div class="crumb">전국  ›  {sido_row.sido_name}  ›  {sig_row.sigungu_name}  ›  <b>마커를 선택하세요</b></div>', unsafe_allow_html=True)
    m1, m2, m3 = st.columns(3)
    m1.metric("전기차", f"{sig_row.ev_count:,.0f}대")
    m2.metric("충전기", f"{sig_row.fast_chargers + sig_row.slow_chargers:,.0f}기")
    m3.metric("부담도", f"{sig_row.burden:.1f}대 / 환산충전기")

    feature = next(f for f in sig_geo["features"] if str(f["properties"]["SIG_CD"]) == sigungu_code)
    min_lng, min_lat, max_lng, max_lat = bounds([feature])
    fmap = folium.Map(location=[stations.lat.mean(), stations.lng.mean()], zoom_start=12, tiles="OpenStreetMap", control_scale=True)
    folium.GeoJson(feature, style_function=lambda _: {"fillColor": "#b9d8c6", "color": "#537a69", "weight": 2, "fillOpacity": .22}).add_to(fmap)
    for row in stations.itertuples():
        available = min(row.fast_available, row.fast_total) + min(row.slow_available, row.slow_total)
        folium.CircleMarker(
            [row.lat, row.lng], radius=9, color="#fff", weight=2, fill=True,
            fill_color="#2f765f" if available else "#b45b55", fill_opacity=1,
            tooltip=f"{row.station_name} · 사용 가능 {available}기",
        ).add_to(fmap)
    fmap.fit_bounds([[min_lat, min_lng], [max_lat, max_lng]], padding=(22, 22))
    result = st_folium(fmap, height=540, use_container_width=True, returned_objects=["last_object_clicked"], key=f"station-map-{sigungu_code}")
    click = result.get("last_object_clicked")
    if click and not stations.empty:
        distances = (stations.lat - float(click["lat"])) ** 2 + (stations.lng - float(click["lng"])) ** 2
        if distances.min() < 0.001:
            st.session_state.station_id = stations.loc[distances.idxmin(), "station_id"]
    chosen_id = st.session_state.get("station_id", stations.iloc[0].station_id if not stations.empty else None)
    if chosen_id and chosen_id in set(stations.station_id):
        row = stations.loc[stations.station_id == chosen_id].iloc[0]
        fast_avail, slow_avail = min(row.fast_available, row.fast_total), min(row.slow_available, row.slow_total)
        st.markdown(f"""
        <div class="station-card"><span class="sample-pill">SAMPLE</span>
        <h3>{row.station_name}</h3><p>{row.address}</p>
        <b>급속</b> {fast_avail}/{row.fast_total}기 사용 가능 &nbsp;·&nbsp;
        <b>완속</b> {slow_avail}/{row.slow_total}기 사용 가능<br><br>
        운영기관 {row.operator} &nbsp;·&nbsp; 운영시간 {row.hours}<br>
        <small>갱신: {row.updated_at}</small></div>
        """, unsafe_allow_html=True)

with st.sidebar:
    st.subheader("부담도 산식")
    st.latex(r"부담도 = \frac{전기차\ 등록대수}{(급속\times2)+완속}")
    st.caption("급속 충전기에 가중치 2를 둔 데모 산식입니다. 정책 기준에 맞게 with_burden()만 교체할 수 있습니다.")
    st.divider()
    st.subheader("데이터 안내")
    st.warning("현재 등록 대수·충전기 수·가용 상태는 모두 시연용 가상 데이터입니다.")
    st.caption("행정경계: 국가공간정보포털(V-World) 원본 기반 공개 GeoJSON, 2023-07-29 배포본")

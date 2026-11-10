"""Streamlit shell for the MySQL-backed SVG map."""

import json
import os
import re
from pathlib import Path

import requests
import streamlit as st
import streamlit.components.v1 as components

from jobs.crawl_registrations import AttachmentParser, LISTING, fetch
from services.charger_status import ChargerStatusError, station_status, sync_info
from services.geocoding import AddressSearchError, search_addresses
from services.kakaomap_api import search_nearby_cafes
from services.mysql_map import district_stations, find_station, map_metrics, nearby_stations, search_stations


ROOT = Path(__file__).parent
MAP_ASSET = ROOT / "assets/maps.json"
st.set_page_config(page_title="EV 충전 인프라 지도", page_icon="⚡", layout="wide", initial_sidebar_state="collapsed")
st.markdown("<style>.stApp{background:#ffffff;color:#1b3123}.block-container{max-width:1600px;padding:0.5rem 1rem}header[data-testid=stHeader]{display:none!important}iframe{border:0}</style>", unsafe_allow_html=True)


@st.cache_data(ttl=300, show_spinner=False)
def load_payload(asset_version):
    maps = json.loads(MAP_ASSET.read_text(encoding="utf-8"))
    return {"maps": maps, **map_metrics()}


@st.cache_data(ttl=3600, show_spinner=False)
def registration_sources():
    page, charset = fetch(LISTING)
    attachments = AttachmentParser()
    attachments.feed(page.decode(charset))
    return {month.strftime("%Y-%m"): {"filename": publication.filename, "url": publication.url}
            for month, candidates in attachments.publications.items() if len(candidates) == 1
            for publication in candidates}


cached_district = st.cache_data(ttl=300, show_spinner=False)(district_stations)
cached_station = st.cache_data(ttl=300, show_spinner=False)(find_station)


def secret(name):
    value = os.environ.get(name, "")
    if value:
        return value
    try:
        return str(st.secrets.get(name, ""))
    except (FileNotFoundError, st.errors.StreamlitSecretNotFoundError):
        return ""


def station_response(action, station_id, kakao_key):
    station = cached_station(station_id)
    if station is None:
        return {"error": "DB에서 충전소를 찾지 못했습니다."}
    if action == "find-station":
        return {"stations": [station]}
    if action == "cafes" and kakao_key and station["sigungu_code"]:
        try:
            places = search_nearby_cafes(station["lat"], station["lng"], kakao_key)
            return {"cafes": [{"name": place["place_name"], "distance": place.get("distance", ""),
                               "address": place.get("road_address_name") or place.get("address_name", "")}
                              for place in places]}
        except (requests.RequestException, KeyError, ValueError, TypeError):
            return {"error": "카카오 주변 카페 조회에 실패했습니다."}
    if action == "stored-status":
        return {"statuses": station_status(station_id), "sync": sync_info()}
    return {"error": "API 키 또는 충전소의 위치 정보를 확인해 주세요."}


def handle_request(request, kakao_key):
    action = request.get("action")
    if action == "registration-sources":
        try:
            return {"sources": registration_sources()}
        except (OSError, ValueError):
            return {"error": "국토교통부 원본 링크를 불러오지 못했습니다. 공개 자료 목록에서 파일명을 확인해 주세요."}
    if action == "district":
        code = str(request.get("code", ""))
        if not re.fullmatch(r"\d{5}", code):
            raise ValueError("유효한 시군구 코드가 필요합니다.")
        return {"stations": cached_district(code)}
    if action in ("search", "geocode"):
        query = str(request.get("query", "")).strip()[:150]
        if action == "geocode" and kakao_key:
            return {"candidates": search_addresses(query, kakao_key)}
        rows = search_stations(query) if query else []
        if action == "search":
            return {"stations": rows}
        addresses = {(r["address"], r["lat"], r["lng"]) for r in rows if r["sigungu_code"]}
        return {"candidates": [{"address": address, "lat": lat, "lng": lng, "source": "DB 등록 주소"}
                               for address, lat, lng in sorted(addresses)[:10]]}
    if action == "nearby":
        return {"stations": nearby_stations(request.get("lat"), request.get("lng"))}
    if action in ("find-station", "stored-status", "cafes"):
        station_id = str(request.get("stationId", ""))[:16]
        return station_response(action, station_id, kakao_key)
    return {"error": "지원하지 않는 조회입니다."}


api_key = secret("KAKAO_REST_API_KEY")
try:
    payload = load_payload(MAP_ASSET.stat().st_mtime_ns)
except ChargerStatusError as exc:
    st.error(str(exc))
    st.stop()

payload["geocoder"] = {"mode": "kakao" if api_key else "database"}
payload["stationApis"] = {"cafes": bool(api_key)}
map_component = components.declare_component("ev_map", path=str(ROOT / "components"))
request = map_component(payload=payload, response=st.session_state.get("map_response"), default=None, key="ev-map-view")
if isinstance(request, dict):
    request_id = str(request.get("requestId", ""))[:100]
    if request_id and st.session_state.get("last_map_request") != request_id:
        try:
            result = handle_request(request, api_key)
        except (AddressSearchError, ChargerStatusError, ValueError) as exc:
            result = {"error": str(exc)}
        except TypeError:
            result = {"error": "조회에 필요한 입력값을 확인해 주세요."}
        st.session_state.last_map_request = request_id
        st.session_state.map_response = {"requestId": request_id, **result}
        st.rerun()

"""Server-only address lookup. Never send the REST key to the component."""
import json
import math
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class AddressSearchError(Exception):
    pass


def search_addresses(query, api_key="", sample_rows=()):
    query = str(query).strip()
    if not 2 <= len(query) <= 150:
        raise AddressSearchError("도로명주소를 2~150자로 입력해 주세요.")
    if not api_key:
        matches = []
        for row in sample_rows:
            if query.replace(" ", "") in (row["addr"] + row["statNm"]).replace(" ", ""):
                matches.append({"address": row["addr"], "lat": float(row["lat"]), "lng": float(row["lng"]), "source": "제공 예시 주소 · 데모"})
        return matches[:10]
    request = Request("https://dapi.kakao.com/v2/local/search/address.json?" + urlencode({"query": query, "size": 10}), headers={"Authorization": "KakaoAK " + api_key})
    try:
        with urlopen(request, timeout=8) as response:
            data = json.load(response)
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise AddressSearchError("주소 검색 인증을 확인해 주세요. 서버의 카카오 REST API 키와 권한 설정이 필요합니다.") from None
        if exc.code == 429:
            raise AddressSearchError("주소 검색 요청 한도를 초과했습니다. 잠시 후 다시 검색해 주세요.") from None
        raise AddressSearchError("주소 검색 서비스가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.") from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise AddressSearchError("주소 검색 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.") from None
    if not isinstance(data, dict) or not isinstance(data.get("documents"), list):
        raise AddressSearchError("주소 검색 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.")
    results, seen = [], set()
    for document in data.get("documents", []):
        address = document.get("road_address") or document.get("address") or {}
        name = address.get("address_name") or document.get("address_name")
        try:
            lat, lng = float(document["y"]), float(document["x"])
        except (KeyError, TypeError, ValueError):
            continue
        if not name or not (math.isfinite(lat) and math.isfinite(lng) and 32 <= lat <= 40 and 123 <= lng <= 133):
            continue
        identity = (name, lat, lng)
        if identity not in seen:
            results.append({"address": name, "lat": lat, "lng": lng, "source": "카카오 주소 검색"})
            seen.add(identity)
    return results

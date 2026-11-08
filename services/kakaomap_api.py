import requests


def search_nearby_cafes(lat, lng, api_key, radius=300, limit=10):
    response = requests.get(
        "https://dapi.kakao.com/v2/local/search/category.json",
        headers={"Authorization": f"KakaoAK {api_key}"},
        params={
            "category_group_code": "CE7",
            "x": lng,
            "y": lat,
            "radius": radius,
            "sort": "distance",
            "size": limit,
        },
        timeout=10,
    )
    response.raise_for_status()
    return response.json()["documents"]

if __name__ == "__main__":
    import streamlit as st

    cafes = search_nearby_cafes(
        lat=37.4979,
        lng=127.0276,
        api_key=st.secrets["KAKAO_REST_API_KEY"],
    )

    if not cafes:
        print("반경 300m 내 카페 검색 결과가 없습니다.")

    for cafe in cafes:
        address = cafe.get("road_address_name") or cafe.get("address_name")
        print(cafe["place_name"], f'{cafe["distance"]}m', address)
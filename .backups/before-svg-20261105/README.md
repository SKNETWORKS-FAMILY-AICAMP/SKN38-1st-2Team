# 전국 전기차 충전 인프라 부담도

전국 시·도 → 시·군·구 → 충전소로 내려가는 Streamlit 지도 데모입니다. **등록 대수, 충전기 수, 충전소와 실시간 상태는 모두 가상 샘플 데이터**입니다. 전기이륜차는 포함하지 않습니다.

## 실행

Windows PowerShell 기준:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
streamlit run app.py
```

브라우저에서 `http://localhost:8501`을 엽니다.

## 사용 흐름

1. 전국 지도에서 시·도를 클릭합니다.
2. 선택한 시·도의 시·군·구 지도에서 구역을 클릭합니다.
3. 충전소 마커를 클릭하면 급속/완속 가용 수, 운영기관, 운영시간을 확인할 수 있습니다.
4. 왼쪽 위의 뒤로 버튼으로 상위 단계로 돌아갑니다.

지도 클릭은 Folium이 반환한 위·경도를 GeoJSON 폴리곤에 대입하는 point-in-polygon 방식이라, 툴팁 문자열이나 화면 레이블에 의존하지 않습니다.

## 데이터 구조와 실데이터 교체

- `data_provider.py`: 화면과 데이터 소스를 분리하는 `EVDataProvider` 인터페이스
- `SampleCsvProvider`: 현재 CSV 샘플 구현
- `ApiOrDatabaseProvider`: 실 API/DB 구현 자리
- `data/sido_metrics.csv`: 시·도 집계
- `data/sigungu_metrics.csv`: 시·군·구 집계
- `data/stations.csv`: 충전소 상세/상태
- `scripts/generate_sample_data.py`: 경계로부터 재현 가능한 가상 CSV 재생성

실서비스에서는 `ApiOrDatabaseProvider`의 세 메서드를 구현하고 `app.py`의 `provider()` 반환값 한 줄만 바꾸면 됩니다. 권장 구성은 차량 등록/충전기 집계는 배치 적재 DB에서 읽고, 충전소 상세를 열 때만 실시간 충전소 API를 호출하는 방식입니다. API 호출에는 타임아웃, 재시도, 캐시 TTL, 마지막 정상 응답 보관을 추가하세요.

## 경계 데이터

`ctprvn.geojson`(17개 시·도)과 `sig.geojson`(250개 시·군·구)은 국가공간정보포털(V-World) 2023-07-29 배포 경계를 WGS84로 재투영·단순화한 공개 파일을 프로젝트에 포함한 것입니다. 출처 표시는 앱 사이드바에도 표시됩니다.

- 원본 계보: 국가공간정보포털(V-World)
- 가공/배포: <https://github.com/KnellBalm/kr-admin-geojson>
- 운영 전 최신화 대안: SGIS 행정구역경계 API의 최신 기준연도 파일로 두 GeoJSON을 교체

## 부담도 산식

`전기차 등록 대수 ÷ (급속 충전기 × 2 + 완속 충전기)`

급속 가중치 2는 시연용 가정입니다. 실제 정책에서는 출력(kW), 가동률, 운영시간, 교통량을 반영하도록 `with_burden()`을 바꾸는 것이 좋습니다.

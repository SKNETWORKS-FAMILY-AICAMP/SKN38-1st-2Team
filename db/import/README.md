# 전기차 데이터 지역 매핑 및 MySQL 적재

## 매핑 결과

- `station_region_map.csv`에는 충전소 ID별 원본 코드, SVG 시도·시군구 코드, 검증 방식이 있습니다. 102,213곳 중 101,355곳이 매핑되었고 858곳은 검토 대상입니다. 검토 대상의 SVG 코드는 비워 두었습니다.
- `charger_region_code_map.csv`는 원본 지역코드와 SVG 코드의 연결 및 충전소 건수입니다. 시 단위 원본 코드 하나가 여러 구에 걸치는 경우가 있어, 마커 연결에는 충전소별 매핑을 사용합니다.
- `registration_region_map.csv`는 등록자료 지역명과 집계 지역코드, SVG 시도 코드의 관계입니다. 전북 집계코드 52는 기존 SVG 45에 연결합니다. 2026년 7월부터 수록된 전남광주 집계코드 12는 SVG 29와 46에 연결하되, 합계는 한 번만 계산합니다.

매핑은 현재 프로젝트에 있는 `sig.geojson`의 경계 안에 좌표가 들어가는지 검증한 결과입니다. 경계 변경, 좌표 오차, 원본 코드 충돌로 검토가 필요한 행의 실제 행정구역은 추가 확인이 필요합니다.

## 실행

저장소 루트에서 다음 검증을 실행합니다. 원본 데이터 폴더는 환경에 맞게 지정합니다. 기본 매핑 경로는 저장소의 `.local/import_snapshot`입니다. 새 환경에서는 검증된 적재 패키지의 매핑 CSV 3개와 `snapshot_hashes.json`을 이 경로에 준비하거나 `--map-dir`로 지정합니다.

```powershell
python .\db\import\load_mysql.py --source-dir 'C:\Users\Admin\myprojects\전기차\db' --dry-run
```

기존 MySQL 데이터베이스와 로컬 로그인 경로를 지정하면 실제 적재를 진행합니다. 비밀번호 입력은 MySQL 로그인 경로를 설정할 때 처리합니다.

```powershell
python .\db\import\load_mysql.py --source-dir 'C:\Users\Admin\myprojects\전기차\db' --database DB_NAME --login-path LOGIN_NAME
```

스크립트는 파일 해시를 확인한 다음 UTF-8과 UTF-8 BOM을 같은 방식으로 읽습니다. ID와 코드의 선행 0을 유지하고, 텍스트 필드에는 UTF-8을 사용합니다. MySQL에는 고유한 이름의 적재 테이블을 만들고 행 수와 충전소·충전기·상태의 연결을 확인한 뒤 최종 이름으로 바꿉니다. 같은 이름의 서비스 테이블이 있으면 적재를 중단합니다. 실패한 적재 테이블이 있다면 실행 시 표시된 접두사로 구분할 수 있습니다.

충전기 529,359행과 카페 113,440행을 모두 읽습니다. `charger.source_row`, `cafe.source_row`는 CSV 행의 전체 컬럼을 JSON으로 보존합니다. `deleted_flag`, `limited_flag`도 보존합니다. 충전기 출력은 `output_kw`에 저장하며 비어 있거나 숫자로 해석할 수 없으면 NULL로 둡니다. 급속·완속 집계는 서비스 조회에서 정격출력과 충전방식 기준을 정해 적용할 수 있습니다. 상태의 API 조회 완료 시각은 초기 적재 시 NULL이며, 실제 API 확인 후 기록합니다.

매핑 생성 코드의 사용법은 `python .\db\import\build_region_mapping.py <원본폴더> .\data\geo\sig.geojson <출력폴더>`입니다. 기존 적재기는 검증된 원본 해시와 행 수를 기준으로 동작합니다. 새 스냅샷의 검증·버전 관리와 독립 SQL 마이그레이션은 [스키마 계획](../../docs/schema-plan.md)에 정리했습니다.

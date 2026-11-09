# Windows에서 전기차 충전 인프라 지도 재현하기

팀원이 자신의 Windows PC에서 저장소를 받아 **MySQL 복원 → 웹 실행 → 수집 작업 등록**을 따라가는 가이드입니다. 각자 받은 저장소 경로, MySQL 계정, API 키를 사용합니다.

## 1. 준비물

| 준비물 | 받는 곳 또는 확인 방법 |
| --- | --- |
| 프로젝트 소스 | 팀 저장소의 `donghee` 브랜치 |
| Git, Python 3.10 이상, MySQL 8.0 서버·클라이언트 | PC에 설치하고 MySQL 서버가 실행 중인지 확인 |
| `ev_infra_*.sql` | 프로젝트 담당자에게 별도로 받는 전체 DB 덤프. Git의 `data/sample/`은 확인용 표본입니다. |
| 로컬 MySQL 계정 | 각 PC에서 접속과 복원 권한을 가진 계정 |
| 공공데이터포털 서비스 키 | 전국 충전기 상태 수집을 사용할 때 준비 |
| 카카오 로컬 REST API 키 | 일반 도로명주소 좌표 검색과 주변 카페 기능을 사용할 때 준비 |

## 2. 저장소와 Python 환경 준비

PowerShell에서 저장소를 받을 폴더로 이동한 뒤 실행합니다. `$repoUrl`을 실제 저장소 주소로 바꿉니다.

```powershell
$repoUrl = '팀 Git 저장소 주소'
git clone --branch donghee $repoUrl ev-infra-map
Set-Location .\ev-infra-map

py -3 -m venv .venv
$pythonExe = (Resolve-Path .\.venv\Scripts\python.exe).Path
& $pythonExe -m pip install -r requirements.txt
& $pythonExe --version
(Get-Location).Path
$pythonExe
```

마지막 두 줄에 표시되는 **프로젝트 루트 절대경로**와 **Python 절대경로**를 적어둡니다. 이미 Conda 환경을 쓰고 있다면 해당 환경의 `python.exe`를 `$pythonExe`로 지정하고 같은 방식으로 의존성을 설치할 수 있습니다.

## 3. 각 PC의 MySQL 연결과 DB 복원

`evlocal`은 이 PC의 Windows 사용자에 저장되는 MySQL 로그인 경로입니다. 웹앱과 스케줄러를 같은 Windows 사용자로 실행하면 한 번 설정하면 됩니다. 계정이나 설치 위치가 다르면 아래 값을 바꿉니다.

```powershell
$mysqlBin = 'C:\Program Files\MySQL\MySQL Server 8.0\bin'
$mysqlExe = Join-Path $mysqlBin 'mysql.exe'
$dbUser = '본인 MySQL 사용자명'

& (Join-Path $mysqlBin 'mysql_config_editor.exe') set --login-path=evlocal --host=127.0.0.1 --port=3306 "--user=$dbUser" --password
& $mysqlExe --login-path=evlocal -e "SELECT CURRENT_USER(); SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='ev_infra';"
```

로그인 경로를 설정할 때 로컬 MySQL 비밀번호를 입력합니다. **기존 `ev_infra`가 조회되면 복원 전에 내용을 확인하세요.** 공유 덤프에는 `ev_infra`를 선택하는 구문과 동명 테이블을 삭제하고 재생성하는 구문이 들어 있어 기존 데이터가 교체될 수 있습니다. 원본 PC의 MySQL 계정·비밀번호는 덤프에 포함되지 않습니다.

새 환경에서 아래의 SQL 파일 경로를 실제 파일 위치로 바꾸고 실행합니다. 덤프가 크므로 PowerShell에서 파일 전체를 메모리에 읽지 않고 MySQL의 표준입력으로 연결합니다.

```powershell
$sqlDump = 'C:\경로\ev_infra_백업파일.sql'
$importJob = Start-Process -FilePath $mysqlExe `
    -ArgumentList '--login-path=evlocal','--default-character-set=utf8mb4' `
    -RedirectStandardInput $sqlDump -WindowStyle Hidden -Wait -PassThru
if ($importJob.ExitCode -ne 0) { throw "MySQL 복원 실패. 종료 코드 $($importJob.ExitCode)" }

& $mysqlExe --login-path=evlocal --database=ev_infra -e "SHOW TABLES; SELECT MAX(report_month) FROM ev_sido_monthly; SELECT COUNT(*) FROM charging_station;"
```

복원 후 **테이블 9개**, 등록통계 기준월, 충전소 행 수를 확인합니다. 전체 SQL 덤프 대신 검증된 원본 CSV 묶음을 받은 경우에는 [원본 적재 가이드](../db/import/README.md)를 사용합니다.

## 4. API 키를 설정하고 웹 실행

- **웹에서 카카오 연동을 사용할 때**는 `.streamlit/secrets.toml.example`을 복사해 같은 폴더에 `secrets.toml`을 만들고 본인의 `KAKAO_REST_API_KEY`를 입력합니다. 키 설정 없이도 MySQL 지도와 등록 주소 기반 검색을 사용할 수 있습니다.
- **충전기 상태 작업을 사용할 때**는 Windows에서 **계정의 환경 변수 편집 → 사용자 변수 → 새로 만들기**를 열어 `EV_CHARGER_SERVICE_KEY`를 설정합니다. 작업을 실행할 계정의 사용자 변수여야 합니다. 설정 후 새 PowerShell에서 확인하고, 예약 작업에 환경변수가 전달되지 않으면 해당 계정에서 로그아웃한 뒤 다시 로그인해 확인합니다.
- 월별 등록 크롤러는 공개 목록을 읽습니다. 해당 작업에는 MySQL 로그인 경로가 필요합니다.

```powershell
& $pythonExe -m streamlit run app.py
```

터미널에 표시되는 주소를 브라우저에서 열고 **서울 → 관악구 → 충전소 상세**까지 확인합니다. 두 수집 작업은 웹과 별도 프로세스로 실행합니다. 아래 수동 확인은 프로젝트 루트의 새 PowerShell에서 진행합니다. 새 창에서는 `$pythonExe`에 앞에서 확인한 절대경로를 다시 지정합니다.

```powershell
# 등록통계 원본과 DB 비교. 이 명령은 DB를 조회합니다.
& $pythonExe -m jobs.crawl_registrations --months 2026-07 2026-08 2026-09

# 충전기 상태 수집 한 번. 실제 API를 호출하고 조건에 맞는 상태를 DB에 저장합니다.
& $pythonExe -m jobs.poll_charger_status
```

## 5. Windows 작업 스케줄러에 두 작업 등록

**작업 스케줄러 → 작업 만들기**에서 아래 설정으로 작업을 두 개 만듭니다. 사용자 계정은 앞에서 로그인 경로와 환경변수를 설정한 계정으로 지정합니다.

| 항목 | 월별 자동차 등록통계 | 충전기 상태 수집 |
| --- | --- | --- |
| 작업 이름 예시 | `ev_car_registration` | `ev_charger_status` |
| 일반 | 사용자 로그온 여부와 관계없이 실행 | 동일 |
| 트리거 | 매일 1회, 원하는 시각 | 한 번 시작한 뒤 **5분마다** 반복, 기간 **무기한** |
| 동작 | 프로그램 시작 | 프로그램 시작 |
| 프로그램/스크립트 | 2단계에서 확인한 Python 절대경로 | 동일 |
| 인수 추가 | `-m jobs.crawl_registrations --sync-new` | `-m jobs.poll_charger_status` |
| 시작 위치 | 2단계에서 확인한 프로젝트 루트 절대경로 | 동일 |
| 이미 실행 중일 때 | 새 인스턴스를 시작하지 않음 | 동일 |

**시작 위치**에는 `app.py`가 있는 폴더 경로를 따옴표 없이 입력합니다. 스케줄러는 지정한 환경의 `python.exe`를 직접 실행합니다. 두 작업의 인수는 서로 다르며 `--sync-new`는 등록통계 작업에만 사용합니다.

## 6. 실행 결과 확인

작업 스케줄러 왼쪽에서 **작업 스케줄러(로컬)**를 선택하고 오른쪽의 **모든 작업 기록 사용**을 누릅니다. 등록한 작업을 각각 한 번 실행하고 F5로 새로고침한 뒤 **마지막 실행 결과**와 아래 증거를 확인합니다.

| 작업 | `0x0`과 함께 확인할 항목 |
| --- | --- |
| 월별 자동차 등록통계 | 신규 월이 있으면 DB 기준월이 바뀌고 `jobs/results/mysql_sync_verification.csv`가 생성됩니다. 신규 월이 없으면 기준월이 그대로인 상태에서 정상 종료합니다. |
| 충전기 상태 수집 | `.local/charger_status/sync.log`에 **전국 변경분 수집 완료**, `sync.json`에 최신 성공 시각이 기록됩니다. DB 관측 시각과 다음 5분 주기의 로그도 확인합니다. |

```powershell
Get-Content .\.local\charger_status\sync.log -Tail 10
& $mysqlExe --login-path=evlocal --database=ev_infra -e "SELECT COUNT(last_successful_check_at_utc), MAX(last_successful_check_at_utc) FROM charger_status_latest;"
```

- **`0x41303`**이면 작업의 마지막 실행 결과가 아직 기록되지 않았습니다. 기록 탭에서 작업과 동작이 시작됐는지 확인합니다.
- **`0x2`**이면 Python 인수부터 확인합니다. 예전에 충전기 작업에 `--sync-new`를 넣었을 때 이 코드가 나왔습니다.
- **`0x1`**이면 충전기 로그의 마지막 오류를 확인합니다. 키가 보이지 않는 경우 작업 계정의 사용자 환경변수를, DB 오류라면 같은 계정의 `evlocal` 접속을 확인합니다.

[충전기 상태 수집 운영](charger-status-sync.md) · [월별 등록 크롤러 운영](registration-crawler.md) · [실행 문제를 해결한 과정](development-retrospective.md)

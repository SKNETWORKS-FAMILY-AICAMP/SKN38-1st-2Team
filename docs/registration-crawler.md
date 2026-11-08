# 월별 자동차 등록자료 수집기

국토교통부 통계누리의 자동차등록현황보고 목록을 읽고, 월별 자동차 엑셀을 내려받아 `ev_infra`의 적재본과 비교합니다. 목록에서 기준월과 실제 다운로드에 쓰이는 파일명을 읽습니다. 화면에 표시되는 제목과 서버의 파일명이 다른 경우도 처리합니다.

## 실행

저장소 루트의 PowerShell에서 `python -m pip install -r requirements.txt`를 실행한 뒤 진행합니다. 기본 설정은 로컬 MySQL의 `evlocal` 로그인 경로와 `ev_infra` 데이터베이스입니다.

```powershell
$crawler = '.\jobs\crawl_registrations.py'
python $crawler --months 2026-07 2026-08 2026-09 --list
python $crawler --months 2026-07 2026-08 2026-09
```

`--list`는 수집 대상 파일명과 URL을 출력합니다. `--months`를 생략하면 목록에서 확인한 최신 3개월을 선택합니다. 저장 위치는 `--output-dir`, 데이터베이스 이름과 로그인 경로는 `--database`, `--login-path`로 지정할 수 있습니다.

JupyterLab에서는 새 Python 셀에 다음을 입력합니다.

```python
%run "./jobs/crawl_registrations.py" --months 2026-07 2026-08 2026-09
```

## 비교 기준

- `passenger_ev`는 10번 시트의 전국 비사업용 전기 승용차 등록대수입니다.
- `passenger_total`은 10번 시트의 전국 비사업용 승용차 등록대수입니다. 01번 시트의 관용과 자가용 합계와 대조합니다.
- `regional_ev`는 10번 시트의 시도별 전기차 등록대수로, 차종 전체를 포함합니다. `전남광주`는 원본의 합산 지역명으로 한 번 비교합니다.

`jobs/results/raw`에는 파일 내용의 SHA-256을 붙여 원본을 보관합니다. 같은 내용은 기존 파일을 재사용합니다. `jobs/results/mysql_comparison.csv`의 각 행에서 수집값, MySQL 값, 차이, 원본 파일명과 해시를 확인할 수 있습니다. `NEW`는 MySQL에서 아직 발견하지 못한 집계입니다. `DIFFERENT` 또는 `MYSQL_ONLY`가 있으면 보고서를 남기고 종료 코드 1을 반환합니다. 위 비교 명령은 MySQL에 조회 쿼리만 실행합니다.

## 신규 월 적재

배포 PC의 PowerShell에서 다음 명령으로 신규 월 적재를 실행할 수 있습니다. 아래 예시는 저장소 루트에서 실행합니다. 배포 PC에서는 작업 스케줄러에 Python과 스크립트의 전체 경로를 지정합니다.

```powershell
$crawler = '.\jobs\crawl_registrations.py'
python $crawler --sync-new
```

이 모드는 MySQL 최신 기준월 이후에 공개된 엑셀을 수집합니다. 기준월, 시트 간 합계, 기존 지역코드 매핑과 연속 월 여부를 검증한 뒤 `ev_passenger_monthly`와 `ev_sido_monthly`를 한 트랜잭션에 저장합니다. 기존 월은 비교 모드로 확인할 수 있습니다. 새 월 적재 후 `jobs/results/mysql_sync_verification.csv`에 MySQL 재조회 결과를 남깁니다. 이 PC에서 통계누리 인터넷 접속과 로컬 MySQL 접속이 가능해야 합니다.

매일 실행하려면 배포 PC의 Windows 작업 스케줄러에서 일일 작업을 만듭니다. 동작의 프로그램에 Python 실행 파일의 전체 경로를 지정하고, 인수에 크롤러 파일의 전체 경로와 `--sync-new`를 넣습니다. 작업을 실행할 Windows 계정에서 `mysql_config_editor`로 `evlocal`을 설정합니다. 예약 시간을 놓친 뒤 실행하는 옵션과 기존 작업이 실행 중일 때 새 인스턴스를 시작하지 않는 옵션을 설정할 수 있습니다. 저장 후 작업 스케줄러에서 한 번 수동 실행해 마지막 실행 결과를 확인합니다.

[국토교통부 통계누리 자동차등록현황보고](https://stat.molit.go.kr/portal/cate/statMetaView.do?hFormId=1244&hRsId=58)

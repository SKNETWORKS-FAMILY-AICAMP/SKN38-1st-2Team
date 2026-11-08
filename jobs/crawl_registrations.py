"""Collect monthly MOLIT registration workbooks and compare them with MySQL."""

import argparse
import csv
import hashlib
import re
import subprocess
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from openpyxl import load_workbook


ORIGIN = "https://stat.molit.go.kr"
LISTING = ORIGIN + "/portal/cate/statMetaView.do?hFormId=1244&hRsId=58"
DOWNLOAD_PATH = "/portal/common/downLoadFile.do"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
DOWNLOAD_CALL = re.compile(r"\bdownFile\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'(/stat_file/)'\s*,")
CAR_FILE = re.compile(r"(\d{4})년\s*(\d{1,2})월\s*자동차\s*등록(?:자료|현황)\s*통계\s*\.xlsx", re.I)
TOTAL = {"계", "합계", "총계"}


@dataclass(frozen=True)
class Publication:
    month: date
    filename: str
    url: str


class AttachmentParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.publications = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag != "a" or attrs.get("href") != DOWNLOAD_PATH:
            return
        call = DOWNLOAD_CALL.search(attrs.get("onclick") or "")
        if not call:
            return
        original, stored, folder = call.groups()
        match = CAR_FILE.fullmatch(original)
        if not match:
            return
        month = date(*map(int, match.groups()), 1)
        query = urlencode(dict(oFileName=original, rFileName=stored, midpath=folder))
        publication = Publication(month, original, f"{ORIGIN}{DOWNLOAD_PATH}?{query}")
        self.publications.setdefault(month, set()).add(publication)


def fetch(url):
    request = Request(url, headers={"User-Agent": "EVInfraRegistrationStudy/1.0", "Referer": LISTING})
    with urlopen(request, timeout=30) as response:
        return response.read(), response.headers.get_content_charset() or "utf-8-sig"


def label(value):
    return re.sub(r"\s+", "", str(value)) if value is not None else ""


def sheet_rows(book, name, month):
    sheet, = (sheet for sheet in book if label(sheet.title) == name)
    rows = list(sheet.values)
    month_label = re.fullmatch(r"(\d{4})[.\-/](\d{1,2})", label(rows[1][1]))
    if not month_label or date(*map(int, month_label.groups()), 1) != month:
        raise ValueError(f"{name}: 기대 기준월 {month:%Y-%m}과 엑셀 기준월이 다릅니다.")
    return rows


def validated_counts(row, last):
    values = [0 if value is None else value for value in row[3:last]]
    total = row[last]
    if any(type(value) is not int or value < 0 for value in [*values, total]) or sum(values) != total:
        raise ValueError("시도별 합계와 전국 수치가 일치하지 않거나 수치 형식이 다릅니다.")
    return values, total


def extract(workbook_bytes, month):
    book = load_workbook(BytesIO(workbook_bytes), read_only=True, data_only=True)
    try:
        fuel_rows = sheet_rows(book, "10.연료별_등록현황", month)
        summary_rows = sheet_rows(book, "01.통계표", month)
    finally:
        book.close()

    last, = (i for i, value in enumerate(fuel_rows[2][3:], 3) if label(value) in TOTAL)
    regions = [str(value).strip() if value is not None else "" for value in fuel_rows[2][3:last]]
    if not regions or "" in regions or len(set(regions)) != len(regions):
        raise ValueError("시도 헤더가 비어 있거나 중복됩니다.")

    counts = {}
    fuel = vehicle = ""
    for row in fuel_rows[4:]:
        new_fuel = label(row[0])
        if new_fuel and new_fuel != fuel:
            fuel, vehicle = new_fuel, ""
        vehicle = label(row[1]) or vehicle
        use = label(row[2])
        key = (fuel, vehicle, use)
        if key in {("전기", "승용", "비사업용"), ("총계", "승용", "비사업용"), ("전기", "소계", "계")}:
            if key in counts:
                raise ValueError(f"집계 행 중복: {key}")
            counts[key] = validated_counts(row, last)

    _, passenger_ev = counts["전기", "승용", "비사업용"]
    _, passenger_total = counts["총계", "승용", "비사업용"]
    regional_ev, national_ev = counts["전기", "소계", "계"]

    first_passenger, = (i for i, value in enumerate(summary_rows[2]) if label(value) == "승용")
    if [label(value) for value in summary_rows[3][first_passenger:first_passenger + 2]] != ["관용", "자가용"]:
        raise ValueError("01번 시트의 승용차 용도 열이 예상과 다릅니다.")
    summary, = (row for row in summary_rows[5:] if label(row[0]) in TOTAL)
    official, private = summary[first_passenger:first_passenger + 2]
    if (not 0 <= passenger_ev <= national_ev or not 0 <= passenger_ev <= passenger_total
            or passenger_total <= 0 or passenger_total != official + private):
        raise ValueError("전기차 대수 또는 01·10번 시트의 비사업용 승용차 합계가 일치하지 않습니다.")

    records = {("passenger_ev", "전국"): passenger_ev, ("passenger_total", "전국"): passenger_total}
    records.update({("regional_ev", region): value for region, value in zip(regions, regional_ev, strict=True)})
    return records


def mysql_query(args, sql):
    result = subprocess.run(
        [args.mysql, f"--login-path={args.login_path}", f"--database={args.database}",
         "--default-character-set=utf8mb4", "--batch", "--raw", "--skip-column-names"],
        input=sql, capture_output=True, encoding="utf-8", timeout=60,
    )
    if result.returncode:
        raise ValueError(result.stderr.strip())
    return [line.split("\t") for line in result.stdout.splitlines()]


def mysql_records(args, months):
    month_sql = ",".join(f"'{month.isoformat()}'" for month in months)
    sql = f"""
        SELECT report_month, 'passenger_ev', '전국', ev_count
        FROM ev_passenger_monthly WHERE report_month IN ({month_sql})
        UNION ALL
        SELECT report_month, 'passenger_total', '전국', non_business_passenger_count
        FROM ev_passenger_monthly WHERE report_month IN ({month_sql})
        UNION ALL
        SELECT report_month, 'regional_ev', source_region_name, ev_count
        FROM ev_sido_monthly WHERE report_month IN ({month_sql})
    """
    records = {}
    for month, metric, region, value in mysql_query(args, sql + ";"):
        key = (date.fromisoformat(month), metric, region)
        if key in records:
            raise ValueError(f"MySQL 집계 키 중복: {key}")
        records[key] = int(value)
    return records


def latest_month(args):
    (passenger, regional), = mysql_query(args, """
        SELECT (SELECT MAX(report_month) FROM ev_passenger_monthly),
               (SELECT MAX(report_month) FROM ev_sido_monthly);
    """)
    if passenger == "NULL" or passenger != regional:
        raise ValueError("전국·시도 등록통계의 최신 기준월을 먼저 확인하세요.")
    return date.fromisoformat(passenger)


def month_number(month):
    return month.year * 12 + month.month


def sql_text(value):
    return f"CONVERT(X'{value.encode('utf-8').hex()}' USING utf8mb4)"


def insert_new_months(args, baseline, months, downloaded, sources):
    expected = dict(mysql_query(args, f"""
        SELECT source_region_name, aggregate_region_code
        FROM ev_sido_monthly WHERE report_month = '{baseline.isoformat()}';
    """))
    mapped = set(map(tuple, mysql_query(args, """
        SELECT DISTINCT source_region_name, aggregate_region_code FROM registration_region_map;
    """)))
    if not expected or not set(expected.items()).issubset(mapped):
        raise ValueError("최신 월의 지역코드와 등록지역 매핑표가 일치하지 않습니다.")

    statements = ["SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';", "START TRANSACTION;"]
    for month in months:
        values = {(metric, region): count for (period, metric, region), count in downloaded.items() if period == month}
        regional = {region: count for (metric, region), count in values.items() if metric == "regional_ev"}
        if regional.keys() != expected.keys():
            raise ValueError(f"{month:%Y-%m}: 시도 구성이 달라졌습니다. 지역 매핑을 확인하세요.")
        period = f"'{month.isoformat()}'"
        filename = sql_text(sources[month][0])
        ev, total = values["passenger_ev", "전국"], values["passenger_total", "전국"]
        statements.append("INSERT INTO ev_passenger_monthly "
                          "(report_month, ev_count, non_business_passenger_count, source_file) "
                          f"VALUES ({period}, {ev}, {total}, {filename});")
        rows = [f"({period}, {sql_text(expected[region])}, {sql_text(region)}, {count}, {filename})"
                for region, count in sorted(regional.items())]
        statements.append("INSERT INTO ev_sido_monthly "
                          "(report_month, aggregate_region_code, source_region_name, ev_count, source_file) "
                          "VALUES " + ", ".join(rows) + ";")
    statements.append("COMMIT;")
    mysql_query(args, "\n".join(statements) + "\n")


@contextmanager
def atomic_output(path, mode, **options):
    with NamedTemporaryFile(mode, dir=path.parent, delete=False, **options) as file:
        temporary = Path(file.name)
        try:
            yield file
            file.close()
            temporary.replace(path)
        finally:
            file.close()
            temporary.unlink(missing_ok=True)


def compare(downloaded, stored, sources, report):
    statuses = {}
    with atomic_output(report, "w", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(("report_month", "metric", "region", "downloaded_count", "mysql_count",
                         "difference", "status", "source_file", "sha256"))
        for month, metric, region in sorted(downloaded.keys() | stored.keys()):
            key = (month, metric, region)
            new, old = downloaded.get(key), stored.get(key)
            if new is None:
                status = "MYSQL_ONLY"
            elif old is None:
                status = "NEW"
            else:
                status = "MATCH" if new == old else "DIFFERENT"
            statuses[status] = statuses.get(status, 0) + 1
            difference = new - old if new is not None and old is not None else None
            writer.writerow((month, metric, region, new, old, difference, status, *sources[month]))
    return statuses


def parse_month(value):
    if not re.fullmatch(r"\d{4}-\d{2}", value):
        raise argparse.ArgumentTypeError("YYYY-MM 형식으로 입력하세요.")
    try:
        return date.fromisoformat(value + "-01")
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--months", nargs="+", type=parse_month, help="YYYY-MM 목록. 생략하면 최신 3개월")
    parser.add_argument("--list", action="store_true", help="첨부파일 제목과 URL만 출력")
    parser.add_argument("--sync-new", action="store_true", help="MySQL 최신 월 이후 새 월을 검증해 저장")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent / "results")
    parser.add_argument("--mysql", default=MYSQL)
    parser.add_argument("--database", default="ev_infra")
    parser.add_argument("--login-path", default="evlocal")
    args = parser.parse_args()
    if args.sync_new and (args.months or args.list):
        parser.error("--sync-new는 --months 또는 --list와 함께 사용할 수 없습니다.")

    page, charset = fetch(LISTING)
    attachments = AttachmentParser()
    attachments.feed(page.decode(charset))
    if not attachments.publications:
        raise ValueError("월별 자동차 첨부파일을 찾지 못했습니다. 통계누리 목록 형식을 확인하세요.")
    if args.sync_new:
        baseline = latest_month(args)
        months = sorted(month for month in attachments.publications if month > baseline)
        if not months:
            print(f"신규 자료 없음. MySQL 최신 기준월: {baseline:%Y-%m}")
            return 0
        for previous, current in zip([baseline, *months], months):
            if month_number(current) != month_number(previous) + 1:
                raise ValueError(f"월별 자료 누락: {previous:%Y-%m} 다음 월을 찾지 못했습니다.")
    else:
        months = sorted(set(args.months)) if args.months else sorted(attachments.publications)[-3:]
    publications = []
    for month in months:
        candidates = attachments.publications.get(month, set())
        if len(candidates) != 1:
            raise ValueError(f"{month:%Y-%m}: 다운로드 후보 {len(candidates)}개. 공개 목록을 확인하세요.")
        publication, = candidates
        publications.append(publication)
        print(f"{month:%Y-%m}  {publication.filename}", flush=True)
        if args.list:
            print(publication.url)
    if args.list:
        return 0

    raw_dir = args.output_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    downloaded, sources = {}, {}
    for publication in publications:
        time.sleep(0.5)
        data, _ = fetch(publication.url)
        try:
            extracted = extract(data, publication.month)
        except Exception as error:
            raise ValueError(f"{publication.filename}: 엑셀 검증 실패 ({error})") from error
        sha256 = hashlib.sha256(data).hexdigest()
        path = raw_dir / f"{publication.month:%Y-%m}_{sha256}.xlsx"
        if not path.exists():
            with atomic_output(path, "wb") as file:
                file.write(data)
        sources[publication.month] = (publication.filename, sha256)
        downloaded.update({(publication.month, *key): value for key, value in extracted.items()})

    if args.sync_new:
        insert_new_months(args, baseline, months, downloaded, sources)
        print("신규 적재 완료:", ", ".join(f"{month:%Y-%m}" for month in months))
    stored = mysql_records(args, months)
    report = args.output_dir / ("mysql_sync_verification.csv" if args.sync_new else "mysql_comparison.csv")
    statuses = compare(downloaded, stored, sources, report)
    print(statuses)
    print(report.resolve())
    discrepancies = {"DIFFERENT", "MYSQL_ONLY"}
    if args.sync_new:
        discrepancies.add("NEW")
    return 1 if discrepancies & statuses.keys() else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"오류: {error}") from error

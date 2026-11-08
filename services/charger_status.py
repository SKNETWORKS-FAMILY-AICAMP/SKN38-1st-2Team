"""Fetch recent KECO status changes and apply them to registered chargers."""

import hashlib
import json
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree

import requests


STATUS_URL = "https://apis.data.go.kr/B552584/EvCharger/getChargerStatus"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
STATUS_PAGE_SIZE = 9999
STATUS_PAGE_LIMIT = 20


class ChargerStatusError(Exception):
    pass


@dataclass(frozen=True)
class StatusBatch:
    changes: dict
    pages: int
    received: int
    total_counts: tuple
    ambiguous: int
    malformed: int


def recent_changes(service_key, before_request):
    """Read the nationwide rolling ten-minute window, one page at a time."""
    changes, totals = {}, []
    seen_pages = set()
    received = malformed = 0
    page_size = None
    for page in range(1, STATUS_PAGE_LIMIT + 1):
        before_request()
        try:
            result = requests.get(STATUS_URL, params={"serviceKey": unquote(service_key),
                                  "period": 10, "pageNo": page, "numOfRows": STATUS_PAGE_SIZE}, timeout=(3, 8))
            result.raise_for_status()
            root = ElementTree.fromstring(result.content)
        except (requests.RequestException, ElementTree.ParseError):
            raise ChargerStatusError("충전기 상태 API에 연결할 수 없습니다.") from None
        if root.findtext("./header/resultCode") != "00":
            raise ChargerStatusError("충전기 상태 API의 인증과 사용 한도를 확인해 주세요.")
        container = root.find("./body/items")
        items = root.findall("./body/items/item")
        metadata = tuple(root.findtext(f"./body/{field}") for field in ("totalCount", "numOfRows", "pageNo"))
        has_metadata = any(value is not None for value in metadata)
        if page > 1 and has_metadata != (page_size is not None):
            raise ChargerStatusError("충전기 상태 API의 페이지 정보 형식이 조회 중 바뀌었습니다.")
        if has_metadata:
            try:
                total, size, returned_page = map(int, metadata)
                if (total < 0 or not 0 < size <= STATUS_PAGE_SIZE or returned_page != page
                        or len(items) > size or page_size not in (None, size)):
                    raise ValueError("invalid pagination")
            except (ValueError, TypeError):
                raise ChargerStatusError("충전기 상태 API의 페이지 정보가 올바르지 않습니다.") from None
            totals.append(total)
            page_size = size
        elif (container is None or (container.text or "").strip()
              or len(container) != len(items) or len(items) > STATUS_PAGE_SIZE):
            raise ChargerStatusError("충전기 상태 API의 상태 목록 형식이 올바르지 않습니다.")

        rows = [tuple(item.findtext(field, "").strip() for field in ("statId", "chgerId", "stat", "statUpdDt"))
                for item in items]
        if not has_metadata:
            if not rows:
                break
            fingerprint = hashlib.sha256(json.dumps(sorted(rows)).encode("utf-8")).digest()
            if fingerprint in seen_pages:
                raise ChargerStatusError(f"충전기 상태 API가 {page}페이지에서 이전 페이지를 반복했습니다.")
            seen_pages.add(fingerprint)

        for station, charger, status, changed_text in rows:
            try:
                changed = datetime.strptime(changed_text, "%Y%m%d%H%M%S")
                if not (re.fullmatch(r"[A-Za-z0-9]{1,16}", station) and
                        re.fullmatch(r"[A-Za-z0-9]{1,16}", charger) and re.fullmatch(r"[0-9]", status)):
                    raise ValueError("invalid status row")
            except (ValueError, TypeError):
                malformed += 1
                continue
            key = (station, charger)
            previous = changes.get(key)
            if previous is None or changed > previous[1]:
                changes[key] = (status, changed)
            elif changed == previous[1] and status != previous[0]:
                changes[key] = (None, changed)
        received += len(rows)
        if has_metadata:
            if page * size < total and len(rows) != size:
                raise ChargerStatusError("응답 페이지 크기와 실제 건수가 다릅니다.")
            if page * size >= max(totals):
                if len(set(totals)) == 1 and received != total:
                    raise ChargerStatusError("전국 상태 조회 건수와 실제 응답 행 수가 다릅니다.")
                break
    else:
        raise ChargerStatusError(f"전국 상태 조회가 {STATUS_PAGE_LIMIT}페이지 내에 종료를 확인하지 못했습니다.")
    accepted = {key: change for key, change in changes.items() if change[0] is not None}
    return StatusBatch(accepted, page, received, tuple(totals), len(changes) - len(accepted), malformed)


def mysql_query(sql):
    client = [os.environ.get("EV_MYSQL_EXE", MYSQL),
              f"--login-path={os.environ.get('EV_MYSQL_LOGIN_PATH', 'evlocal')}",
              f"--database={os.environ.get('EV_MYSQL_DATABASE', 'ev_infra')}",
              "--default-character-set=utf8mb4", "--batch", "--raw", "--skip-column-names"]
    try:
        result = subprocess.run(client, input=sql, check=True, capture_output=True, encoding="utf-8", timeout=15)
    except (OSError, subprocess.SubprocessError):
        raise ChargerStatusError("MySQL 데이터 조회 또는 저장에 실패했습니다.") from None
    return result.stdout.splitlines()


def literal(value):
    return f"CONVERT(X'{value.encode('utf-8').hex()}' USING utf8mb4)"


def save_changes(changes, checked_at):
    if not changes:
        return
    rows = [f"({literal(station)}, {literal(charger)}, {literal(status)}, '{changed:%Y-%m-%d %H:%M:%S}')"
            for (station, charger), (status, changed) in changes.items()]
    statements = ["START TRANSACTION;", """
        CREATE TEMPORARY TABLE incoming_status (
            stat_id VARCHAR(16), chger_id VARCHAR(16), status_code VARCHAR(8), changed_at DATETIME,
            PRIMARY KEY (stat_id, chger_id)
        ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
    """]
    for start in range(0, len(rows), 250):
        statements.append("INSERT INTO incoming_status VALUES " + ",".join(rows[start:start + 250]) + ";")
    statements.append(f"""
        INSERT INTO charger_status_latest (stat_id, chger_id, status_code,
            source_status_changed_at_kst, last_successful_check_at_utc)
        SELECT i.stat_id, i.chger_id, i.status_code, i.changed_at, '{checked_at:%Y-%m-%d %H:%M:%S}'
        FROM incoming_status i JOIN charger c USING (stat_id, chger_id)
        LEFT JOIN charger_status_latest existing ON existing.stat_id=i.stat_id AND existing.chger_id=i.chger_id
        WHERE existing.source_status_changed_at_kst IS NULL OR i.changed_at > existing.source_status_changed_at_kst
            OR (i.changed_at = existing.source_status_changed_at_kst AND i.status_code = existing.status_code
                AND existing.last_successful_check_at_utc IS NULL)
        ON DUPLICATE KEY UPDATE
            last_successful_check_at_utc = IF(charger_status_latest.source_status_changed_at_kst IS NULL
                OR i.changed_at > charger_status_latest.source_status_changed_at_kst
                OR (i.changed_at = charger_status_latest.source_status_changed_at_kst
                    AND i.status_code = charger_status_latest.status_code
                    AND charger_status_latest.last_successful_check_at_utc IS NULL),
                '{checked_at:%Y-%m-%d %H:%M:%S}', charger_status_latest.last_successful_check_at_utc),
            status_code = IF(charger_status_latest.source_status_changed_at_kst IS NULL
                OR i.changed_at > charger_status_latest.source_status_changed_at_kst,
                i.status_code, charger_status_latest.status_code),
            source_status_changed_at_kst = GREATEST(COALESCE(charger_status_latest.source_status_changed_at_kst, i.changed_at), i.changed_at);
        COMMIT;
    """)
    mysql_query("\n".join(statements))


def sync_state_path():
    default = Path(__file__).resolve().parents[1] / ".local/charger_status/sync.json"
    return Path(os.environ.get("EV_CHARGER_SYNC_STATE", str(default)))


def sync_info():
    try:
        state = json.loads(sync_state_path().read_text(encoding="utf-8"))
        last = datetime.fromisoformat(state["last_success_utc"])
        stale = (datetime.now(timezone.utc) - last).total_seconds() > 600
    except (OSError, KeyError, ValueError, TypeError):
        return None
    return {"lastSuccess": last.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "stale": stale, "gap": bool(state.get("last_gap_utc"))}


def station_status(station):
    rows = mysql_query(f"""
        SELECT JSON_OBJECT('charger', c.chger_id, 'status', s.status_code, 'outputKw', c.output_kw,
                           'changed', DATE_FORMAT(s.source_status_changed_at_kst, '%Y-%m-%d %H:%i:%s'),
                           'checked', DATE_FORMAT(s.last_successful_check_at_utc, '%Y-%m-%d %H:%i:%s'),
                           'parkingFree', JSON_UNQUOTE(JSON_EXTRACT(c.source_row, '$.parkingFree')),
                           'limitYn', c.limited_flag,
                           'limitDetail', JSON_UNQUOTE(JSON_EXTRACT(c.source_row, '$.limitDetail')))
        FROM charger c LEFT JOIN charger_status_latest s USING (stat_id, chger_id)
        WHERE c.stat_id={literal(station)} AND c.deleted_flag='N' ORDER BY c.chger_id;
    """)
    return [json.loads(row) for row in rows]

"""Run a single nationwide charger-status sync. Schedule it every five minutes."""

import argparse
import json
import logging
import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

from services.charger_status import ChargerStatusError, recent_changes, save_changes, sync_state_path


KST = timezone(timedelta(hours=9))


@contextmanager
def single_run(path):
    import msvcrt

    with path.open("a+b") as lock:
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as exc:
            raise ChargerStatusError("충전기 상태 수집이 이미 실행 중입니다.") from exc
        try:
            yield
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def write_state(path, state):
    with NamedTemporaryFile(mode="w", dir=path.parent, encoding="utf-8", delete=False) as file:
        temporary = Path(file.name)
        try:
            json.dump(state, file)
            file.close()
            temporary.replace(path)
        finally:
            file.close()
            temporary.unlink(missing_ok=True)


def sync(path, service_key, budget):
    state = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    started = datetime.now(timezone.utc)
    last_success = state.get("last_success_utc")
    gap = last_success and started - datetime.fromisoformat(last_success) > timedelta(minutes=10)

    def charge_request():
        today = datetime.now(KST).date().isoformat()
        if state.get("budget_date_kst") != today:
            state.update(budget_date_kst=today, calls=0)
        if state["calls"] >= budget:
            raise ChargerStatusError("수집기의 일일 API 호출 예산을 소진했습니다.")
        state["calls"] += 1
        write_state(path, state)

    batch = recent_changes(service_key, charge_request)
    save_changes(batch.changes, started)
    state["last_success_utc"] = started.isoformat(timespec="seconds")
    state["page_totals_changed"] = len(set(batch.total_counts)) > 1
    if gap:
        state["last_gap_utc"] = started.isoformat(timespec="seconds")
        logging.warning("이전 성공과의 간격이 10분을 넘었습니다. 누락된 상태는 별도 확인이 필요합니다.")
    write_state(path, state)
    logging.info("전국 변경분 수집 완료 | 페이지 %s | 응답 %s행 | 저장 후보 %s키 | 동일 시각 충돌 %s키 | 형식 오류 %s행 | 일일 호출 %s/%s",
                 batch.pages, batch.received, len(batch.changes), batch.ambiguous, batch.malformed, state["calls"], budget)
    if state["page_totals_changed"]:
        logging.warning("페이지 사이 totalCount가 바뀌었습니다. 다음 수집의 겹치는 구간으로 재조회합니다.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--daily-budget", type=int, default=900, help="수집기가 사용하는 하루 API 호출 상한")
    args = parser.parse_args()
    if args.daily_budget < 1:
        parser.error("--daily-budget는 1 이상이어야 합니다.")
    path = sync_state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(), logging.FileHandler(path.with_suffix(".log"), encoding="utf-8")])
    key = os.environ.get("EV_CHARGER_SERVICE_KEY", "").strip()
    if not key:
        logging.error("실행 계정의 환경변수 EV_CHARGER_SERVICE_KEY를 설정하세요.")
        return 1
    try:
        with single_run(path.with_suffix(".lock")):
            sync(path, key, args.daily_budget)
    except (ChargerStatusError, OSError, ValueError) as exc:
        logging.error("충전 상태 수집 실패: %s", exc)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

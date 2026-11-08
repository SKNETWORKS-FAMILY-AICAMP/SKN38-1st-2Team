"""Load the four source CSVs and the three verified region maps into MySQL."""
import argparse
import csv
import hashlib
import json
import math
import re
import subprocess
import uuid
from collections import Counter
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path


TABLES = {
    "station_region_map": """
      stat_id VARCHAR(16) PRIMARY KEY, source_sido_code CHAR(2),
      source_sigungu_code CHAR(5), svg_sido_code CHAR(2), svg_sigungu_code CHAR(5),
      match_method VARCHAR(50) NOT NULL, INDEX (svg_sigungu_code)
    """,
    "charger_region_code_map": """
      source_sido_code VARCHAR(2) NOT NULL, source_sigungu_code VARCHAR(5) NOT NULL,
      svg_sido_code VARCHAR(2) NOT NULL, svg_sigungu_code VARCHAR(5) NOT NULL,
      match_method VARCHAR(50) NOT NULL, station_count INT UNSIGNED NOT NULL,
      PRIMARY KEY (source_sido_code, source_sigungu_code, svg_sido_code, svg_sigungu_code, match_method)
    """,
    "registration_region_map": """
      source_region_name VARCHAR(32) NOT NULL, aggregate_region_code CHAR(2) NOT NULL,
      svg_sido_code CHAR(2) NOT NULL, first_observed_month DATE NOT NULL, last_observed_month DATE NOT NULL,
      PRIMARY KEY (source_region_name, svg_sido_code)
    """,
    "ev_passenger_monthly": """
      report_month DATE PRIMARY KEY, ev_count INT UNSIGNED NOT NULL,
      non_business_passenger_count INT UNSIGNED NOT NULL, source_file VARCHAR(255) NOT NULL
    """,
    "ev_sido_monthly": """
      report_month DATE NOT NULL, aggregate_region_code CHAR(2) NOT NULL,
      source_region_name VARCHAR(32) NOT NULL, ev_count INT UNSIGNED NOT NULL,
      source_file VARCHAR(255) NOT NULL, PRIMARY KEY (report_month, aggregate_region_code),
      INDEX (aggregate_region_code, report_month)
    """,
    "charging_station": """
      stat_id VARCHAR(16) PRIMARY KEY, station_name TEXT NOT NULL, address TEXT,
      lat DECIMAL(10,7) NOT NULL, lng DECIMAL(10,7) NOT NULL, operating_hours TEXT,
      operator_name TEXT, operator_phone VARCHAR(64), source_sido_code CHAR(2),
      source_sigungu_code CHAR(5), svg_sigungu_code CHAR(5), map_match_method VARCHAR(50) NOT NULL,
      INDEX (svg_sigungu_code), INDEX (lat, lng)
    """,
    "charger": """
      stat_id VARCHAR(16) NOT NULL, chger_id VARCHAR(16) NOT NULL, chger_type VARCHAR(8),
      output_kw DECIMAL(10,3), deleted_flag CHAR(1), limited_flag CHAR(1),
      source_row JSON NOT NULL, PRIMARY KEY (stat_id, chger_id)
    """,
    "charger_status_latest": """
      stat_id VARCHAR(16) NOT NULL, chger_id VARCHAR(16) NOT NULL, status_code VARCHAR(8),
      source_status_changed_at_kst DATETIME, last_successful_check_at_utc DATETIME,
      PRIMARY KEY (stat_id, chger_id)
    """,
    "cafe": """
      source_id VARCHAR(64) PRIMARY KEY, poi_id VARCHAR(64) NOT NULL,
      place_name TEXT NOT NULL, branch_name TEXT, road_name TEXT, building_number TEXT,
      lat DECIMAL(10,7) NOT NULL, lng DECIMAL(10,7) NOT NULL,
      base_date DATE, source_row JSON NOT NULL, UNIQUE KEY (poi_id), INDEX (lat, lng)
    """,
}

EXPECTED_COUNTS = {
    "station_region_map": 102213,
    "charger_region_code_map": 620,
    "registration_region_map": 19,
    "ev_passenger_monthly": 81,
    "ev_sido_monthly": 1374,
    "charging_station": 102213,
    "charger": 529359,
    "charger_status_latest": 529359,
    "cafe": 113440,
}

SOURCE_FILES = (
    "ev_charger_info.csv", "cafe_info.csv",
    "ev_passenger_registrations_monthly.csv", "ev_registrations_by_sido_monthly.csv",
)
MAP_FILES = ("station_region_map.csv", "charger_region_code_map.csv", "registration_region_map.csv")


def check_snapshot(source, maps):
    expected = json.loads((maps / "snapshot_hashes.json").read_text(encoding="utf-8"))
    for folder, files in ((source, SOURCE_FILES), (maps, MAP_FILES)):
        for name in files:
            digest = hashlib.sha256()
            with (folder / name).open("rb") as file:
                for chunk in iter(lambda: file.read(1024 * 1024), b""):
                    digest.update(chunk)
            if digest.hexdigest() != expected[name]:
                raise ValueError(f"Snapshot changed: {name}. Rebuild and revalidate the mapping first.")


def read(path, required):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames or []
        if len(fields) != len(set(fields)) or not set(required).issubset(fields):
            raise ValueError(f"{path.name}: unexpected CSV header")
        for line, row in enumerate(reader, 2):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"{path.name}:{line}: unexpected field count")
            yield row


def optional(text):
    return text.strip() or None


def coordinates(lat, lng):
    y, x = float(lat), float(lng)
    if not (math.isfinite(y) and math.isfinite(x) and 32 <= y <= 40 and 123 <= x <= 133):
        raise ValueError("Invalid Korea latitude/longitude")
    return y, x


def timestamp(text):
    try:
        return datetime.strptime(text.strip(), "%Y%m%d%H%M%S").isoformat(sep=" ")
    except ValueError:
        return None


def power(text):
    try:
        value = Decimal(text.strip())
        return value if value.is_finite() and value > 0 else None
    except ArithmeticError:
        return None


def payload(row):
    return json.dumps(row, ensure_ascii=False, separators=(",", ":"))


def records(source, maps):
    stations = {}
    regions = {}
    fields = ("stat_id", "source_sido_code", "source_sigungu_code", "svg_sido_code", "svg_sigungu_code", "match_method")
    for row in read(maps / "station_region_map.csv", fields):
        key = row["stat_id"]
        if key in stations:
            raise ValueError(f"Duplicate mapping: {key}")
        stations[key] = row
        yield "station_region_map", (key, *(optional(row[f]) for f in fields[1:-1]), row["match_method"])
    fields = ("source_sido_code", "source_sigungu_code", "svg_sido_code", "svg_sigungu_code", "match_method")
    for row in read(maps / "charger_region_code_map.csv", (*fields, "station_count")):
        yield "charger_region_code_map", (*(row[f] for f in fields), int(row["station_count"]))
    fields = ("source_region_name", "aggregate_region_code", "svg_sido_code", "first_observed_month", "last_observed_month")
    for row in read(maps / "registration_region_map.csv", fields):
        name, code = row["source_region_name"], row["aggregate_region_code"]
        entry = code, date.fromisoformat(row["first_observed_month"]), date.fromisoformat(row["last_observed_month"])
        if regions.setdefault(name, entry) != entry:
            raise ValueError(f"Conflicting registration group: {name}")
        yield "registration_region_map", tuple(row[f] for f in fields)
    for row in read(source / "ev_passenger_registrations_monthly.csv", ("report_month", "ev_count", "total_count", "source_file")):
        month = date.fromisoformat(row["report_month"])
        ev, total = int(row["ev_count"]), int(row["total_count"])
        if month.day != 1 or not 0 <= ev <= total or total == 0:
            raise ValueError(f"Invalid passenger count: {row}")
        yield "ev_passenger_monthly", (month.isoformat(), ev, total, row["source_file"])
    for row in read(source / "ev_registrations_by_sido_monthly.csv", ("report_month", "region_name", "ev_count", "source_file")):
        month = date.fromisoformat(row["report_month"])
        name, ev = row["region_name"], int(row["ev_count"])
        code, first, last = regions[name]
        if month.day != 1 or ev < 0 or not first <= month <= last:
            raise ValueError(f"Invalid regional count: {row}")
        yield "ev_sido_monthly", (month.isoformat(), code, name, ev, row["source_file"])
    best_station_rows = {}
    charger_fields = ("statId", "chgerId", "statNm", "addr", "lat", "lng", "useTime", "busiNm", "busiCall",
                      "zcode", "zscode", "chgerType", "output", "delYn", "limitYn", "stat", "statUpdDt")
    for row in read(source / "ev_charger_info.csv", charger_fields):
        station, charger = row["statId"].strip(), row["chgerId"].strip()
        mapping = stations[station]
        if not charger or len(station) > 16 or len(charger) > 16:
            raise ValueError("Invalid charger identifier")
        if mapping["source_sido_code"] and (row["zcode"].strip(), row["zscode"].strip()) != (
            mapping["source_sido_code"], mapping["source_sigungu_code"]
        ):
            raise ValueError(f"Source region differs from mapping: {station}")
        lat, lng = coordinates(row["lat"], row["lng"])
        changed = timestamp(row["statUpdDt"])
        order = (row["delYn"] == "N", changed or "", charger)
        if station not in best_station_rows or order > best_station_rows[station][0]:
            best_station_rows[station] = (order, (
                station, row["statNm"], optional(row["addr"]), lat, lng, optional(row["useTime"]),
                optional(row["busiNm"]), optional(row["busiCall"]), optional(row["zcode"]),
                optional(row["zscode"]), optional(mapping["svg_sigungu_code"]), mapping["match_method"],
            ))
        yield "charger", (station, charger, optional(row["chgerType"]), power(row["output"]),
                          optional(row["delYn"]), optional(row["limitYn"]), payload(row))
        yield "charger_status_latest", (station, charger, optional(row["stat"]), changed, None)
    if best_station_rows.keys() != stations.keys():
        raise ValueError("Charging station IDs differ from the mapping file")
    for _, values in best_station_rows.values():
        yield "charging_station", values
    fields = ("ID", "POI_ID", "POI_NM", "BHF_NM", "RDNMADR_NM", "BULD_NO", "LC_LA", "LC_LO", "BASE_DE")
    for row in read(source / "cafe_info.csv", fields):
        lat, lng = coordinates(row["LC_LA"], row["LC_LO"])
        base = datetime.strptime(row["BASE_DE"], "%Y%m%d").date().isoformat() if row["BASE_DE"] else None
        yield "cafe", (row["ID"], row["POI_ID"], row["POI_NM"], optional(row["BHF_NM"]),
                       optional(row["RDNMADR_NM"]), optional(row["BULD_NO"]), lat, lng, base, payload(row))


def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float, Decimal)):
        return str(value)
    return "CONVERT(X'" + value.encode("utf-8").hex() + "' USING utf8mb4)"


def check_counts(counts):
    if counts != EXPECTED_COUNTS:
        raise ValueError(f"Row totals differ from the verified snapshot: {dict(counts)}")


def execute(args):
    if not re.fullmatch(r"[A-Za-z0-9_]+", args.database or "") or not args.login_path:
        raise ValueError("Pass --database and --login-path (do not pass passwords on the command line).")
    client = [args.mysql, f"--login-path={args.login_path}", "--default-character-set=utf8mb4",
              "--batch", "--raw", "--skip-column-names", f"--database={args.database}"]

    def query(sql):
        return subprocess.check_output([*client, "-e", sql], text=True, encoding="utf-8").splitlines()

    existing = set(query("SHOW TABLES"))
    if existing.intersection(TABLES):
        raise ValueError(f"Destination tables already exist: {sorted(existing.intersection(TABLES))}")
    prefix = "_evload_" + uuid.uuid4().hex[:10] + "_"
    print("Staging table prefix:", prefix, flush=True)
    buffers = {name: [] for name in TABLES}
    counts = Counter()
    proc = subprocess.Popen(client, stdin=subprocess.PIPE)

    def send(sql):
        proc.stdin.write((sql + "\n").encode("ascii"))

    def flush(name):
        if buffers[name]:
            send(f"INSERT INTO `{prefix}{name}` VALUES " + ",".join(buffers[name]) + ";")
            buffers[name].clear()

    try:
        for name, definition in TABLES.items():
            send(f"CREATE TABLE `{prefix}{name}` ({definition}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;")
        send("SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';")
        send("START TRANSACTION;")
        for name, values in records(args.source_dir, args.map_dir):
            buffers[name].append("(" + ",".join(map(literal, values)) + ")")
            counts[name] += 1
            if len(buffers[name]) >= 250:
                flush(name)
        check_counts(counts)
        for name in TABLES:
            flush(name)
        send("COMMIT;")
        proc.stdin.close()
        if proc.wait():
            raise RuntimeError("MySQL rejected staging data. Final tables have not been published.")
    except BaseException:
        if not proc.stdin.closed:
            proc.stdin.close()
        proc.wait()
        raise

    comparisons = " UNION ALL ".join(f"SELECT '{name}',COUNT(*) FROM `{prefix}{name}`" for name in TABLES)
    stored = {name: int(count) for name, count in (line.split("\t") for line in query(comparisons))}
    check_counts(stored)
    joins = query(
        f"SELECT COUNT(*) FROM `{prefix}charger` c JOIN `{prefix}charging_station` s USING(stat_id)"
        f" JOIN `{prefix}charger_status_latest` t USING(stat_id,chger_id);"
    )
    if joins != [str(EXPECTED_COUNTS["charger"])]:
        raise ValueError("Station, charger and status relationships are incomplete")
    query("RENAME TABLE " + ", ".join(f"`{prefix}{name}` TO `{name}`" for name in TABLES))
    print("Published and verified:", stored)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--map-dir", type=Path, default=Path(__file__).resolve().parents[2] / ".local/import_snapshot")
    parser.add_argument("--mysql", default=r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe")
    parser.add_argument("--login-path")
    parser.add_argument("--database")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    check_snapshot(args.source_dir, args.map_dir)
    if args.dry_run:
        counts = Counter(name for name, _ in records(args.source_dir, args.map_dir))
        check_counts(counts)
        print("Source files validated. Row totals:", dict(counts))
    else:
        execute(args)


if __name__ == "__main__":
    main()

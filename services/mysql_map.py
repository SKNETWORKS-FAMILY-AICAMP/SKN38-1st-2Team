"""Read the initial aggregates and on-demand map records from MySQL."""

import json
import math
from collections import defaultdict

from services.charger_status import literal, mysql_query
from services.geo_utils import project


STATION = """JSON_OBJECT('station_id', s.stat_id, 'station_name', s.station_name,
    'address', COALESCE(s.address, '주소 미제공'), 'lat', s.lat, 'lng', s.lng,
    'sigungu_code', s.svg_sigungu_code, 'api_sido', s.source_sido_code,
    'operator', COALESCE(s.operator_name, '미제공'), 'hours', COALESCE(s.operating_hours, '미제공'),
    'phone', s.operator_phone, 'source', '충전소 정보',
    'availability', (
        SELECT MAX(CASE
            WHEN latest.status_code = '2' THEN 2
            WHEN latest.status_code IN ('3', '4', '5') THEN 0
            ELSE 1
        END)
        FROM charger c LEFT JOIN charger_status_latest latest USING (stat_id, chger_id)
        WHERE c.stat_id = s.stat_id AND c.deleted_flag = 'N'
    ))"""


def map_stations(where, order="s.stat_id", limit=""):
    return [station_point(json.loads(row)) for row in mysql_query(
        f"SELECT {STATION} FROM charging_station s WHERE {where} ORDER BY {order} {limit};"
    )]


def station_point(station):
    station["point"] = project(station["lng"], station["lat"])
    return station


def district_stations(code):
    return map_stations(f"s.svg_sigungu_code = {literal(code)}", "s.station_name, s.stat_id")


def find_station(station_id):
    return next(iter(map_stations(f"s.stat_id = {literal(station_id)}")), None)


def search_stations(query):
    term = literal(query)
    return map_stations(f"(LOCATE({term}, s.station_name COLLATE utf8mb4_0900_ai_ci) > 0 "
                        f"OR LOCATE({term}, s.address COLLATE utf8mb4_0900_ai_ci) > 0 "
                        f"OR LOWER(s.stat_id) = LOWER({term}))", "s.station_name, s.address, s.stat_id", "LIMIT 20")


def nearby_stations(lat, lng):
    lat, lng = float(lat), float(lng)
    if not (math.isfinite(lat) and math.isfinite(lng) and 32 <= lat <= 40 and 123 <= lng <= 133):
        raise ValueError("국내 위경도 좌표가 필요합니다.")
    distance = f"ST_Distance_Sphere(POINT(s.lng, s.lat), POINT({lng}, {lat}))"
    active = ("s.svg_sigungu_code IS NOT NULL AND EXISTS (SELECT 1 FROM charger c "
              "WHERE c.stat_id=s.stat_id AND c.deleted_flag='N')")
    # Grow the bounding box until its edges are farther than the fifth candidate.
    for radius in (5_000, 25_000, 100_000, None):
        where = active
        if radius is not None:
            lat_delta = radius / 110_000
            lng_delta = radius / (110_000 * math.cos(math.radians(abs(lat) + lat_delta)))
            where += (f" AND s.lat BETWEEN {lat-lat_delta} AND {lat+lat_delta}"
                      f" AND s.lng BETWEEN {lng-lng_delta} AND {lng+lng_delta}")
        rows = mysql_query(f"SELECT JSON_SET({STATION}, '$.distance_m', {distance}) "
                           f"FROM charging_station s WHERE {where} ORDER BY {distance},s.stat_id LIMIT 5;")
        stations = [station_point(json.loads(row)) for row in rows]
        if radius is None or (len(stations) == 5 and stations[-1]["distance_m"] <= radius):
            return stations


def map_metrics():
    rows = mysql_query("""
        SELECT JSON_OBJECT('sido_code', m.svg_sido_code, 'sigungu_code', m.svg_sigungu_code,
            'chargers', COUNT(*), 'fast_chargers', SUM(c.output_kw >= 50) + 0,
            'slow_chargers', SUM(c.output_kw > 0 AND c.output_kw < 30) + 0,
            'public_kw', SUM(CASE WHEN c.limited_flag='N' AND c.output_kw>0 THEN c.output_kw ELSE 0 END))
        FROM charger c LEFT JOIN station_region_map m USING(stat_id)
        WHERE c.deleted_flag='N'
        GROUP BY m.svg_sido_code, m.svg_sigungu_code;
    """)
    supply = defaultdict(lambda: defaultdict(int))
    total = defaultdict(int)
    districts = []
    for item in map(json.loads, rows):
        for field in ("chargers", "fast_chargers", "slow_chargers"):
            item[field] = int(item[field] or 0)
            total[field] += item[field]
            supply[item["sido_code"]][field] += item[field]
        if item["sigungu_code"]:
            supply[item["sido_code"]]["public_kw"] += item.pop("public_kw")
            districts.append(item)

    registrations = [json.loads(row) for row in mysql_query("""
        SELECT JSON_OBJECT('sido_code', m.svg_sido_code, 'group', e.aggregate_region_code,
            'region_name', e.source_region_name, 'ev_count', e.ev_count, 'report_month', e.report_month,
            'source_file', e.source_file)
        FROM ev_sido_monthly e JOIN registration_region_map m
          ON e.aggregate_region_code=m.aggregate_region_code AND e.source_region_name=m.source_region_name
        WHERE e.report_month=(SELECT MAX(report_month) FROM ev_sido_monthly);
    """)]
    groups = defaultdict(list)
    for row in registrations:
        groups[row["group"]].append(row)
    total["ev_count"] = sum(group[0]["ev_count"] for group in groups.values()) if groups else None
    total["public_kw"] = 0
    provinces = []
    for group in groups.values():
        counts = {field: sum(supply[row["sido_code"]][field] for row in group)
                  for field in ("chargers", "fast_chargers", "slow_chargers", "public_kw")}
        total["public_kw"] += counts["public_kw"]
        provinces.extend({**row, **counts, "combined": len(group) > 1} for row in group)
    month = registrations[0]["report_month"][:7] if registrations else ""
    passenger_trend = [json.loads(row) for row in mysql_query("""
        SELECT JSON_OBJECT('month', DATE_FORMAT(report_month, '%Y-%m'),
                           'rate', 100.0 * ev_count / non_business_passenger_count,
                           'evCount', ev_count, 'totalCount', non_business_passenger_count,
                           'sourceFile', source_file)
        FROM ev_passenger_monthly
        WHERE report_month >= '2020-01-01' AND report_month < '2027-01-01'
          AND non_business_passenger_count > 0
        ORDER BY report_month;
    """)]
    return {"sidoMetrics": provinces, "sigunguMetrics": districts, "nationalMetrics": dict(total),
            "reportMonth": month, "passengerTrend": passenger_trend}

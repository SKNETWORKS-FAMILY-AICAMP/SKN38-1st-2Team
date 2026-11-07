"""Small GeoJSON helpers (keeps the demo independent of GeoPandas/Shapely)."""

from __future__ import annotations

from collections.abc import Iterable


def _rings(geometry: dict) -> Iterable[list[list[float]]]:
    if geometry["type"] == "Polygon":
        yield from geometry["coordinates"]
    elif geometry["type"] == "MultiPolygon":
        for polygon in geometry["coordinates"]:
            yield from polygon


def point_in_geometry(lng: float, lat: float, geometry: dict) -> bool:
    """Ray-casting test with hole support for Polygon/MultiPolygon."""
    polygons = (
        [geometry["coordinates"]]
        if geometry["type"] == "Polygon"
        else geometry["coordinates"]
    )
    for polygon in polygons:
        if _point_in_ring(lng, lat, polygon[0]) and not any(
            _point_in_ring(lng, lat, hole) for hole in polygon[1:]
        ):
            return True
    return False


def _point_in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i, (xi, yi, *_) in enumerate(ring):
        xj, yj, *_ = ring[j]
        crosses = (yi > y) != (yj > y)
        if crosses and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def bounds(features: list[dict]) -> tuple[float, float, float, float]:
    points = [point for f in features for ring in _rings(f["geometry"]) for point in ring]
    lngs, lats = zip(*((p[0], p[1]) for p in points))
    return min(lngs), min(lats), max(lngs), max(lats)


def representative_point(geometry: dict) -> tuple[float, float]:
    """Find an interior point using a deterministic center-out grid search."""
    feature = {"geometry": geometry}
    min_lng, min_lat, max_lng, max_lat = bounds([feature])
    center = ((min_lng + max_lng) / 2, (min_lat + max_lat) / 2)
    if point_in_geometry(*center, geometry):
        return center
    for steps in (9, 17, 33):
        candidates = []
        for iy in range(1, steps):
            for ix in range(1, steps):
                lng = min_lng + (max_lng - min_lng) * ix / steps
                lat = min_lat + (max_lat - min_lat) * iy / steps
                candidates.append(((lng - center[0]) ** 2 + (lat - center[1]) ** 2, lng, lat))
        for _, lng, lat in sorted(candidates):
            if point_in_geometry(lng, lat, geometry):
                return lng, lat
    return geometry["coordinates"][0][0][0][:2] if geometry["type"] == "MultiPolygon" else geometry["coordinates"][0][0][:2]

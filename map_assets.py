"""Precompile real WGS84 boundaries into SVG paths in one shared projection."""
import json
import math
from html import escape
from pathlib import Path
from geo_utils import representative_point


def project(lng, lat):
    return [round(float(lng) * 1000, 2), round(-math.degrees(math.log(math.tan(math.pi / 4 + math.radians(float(lat)) / 2))) * 1000, 2)]


def compile_features(path, level):
    result = []
    for feature in json.loads(path.read_text(encoding="utf-8"))["features"]:
        prop, geometry = feature["properties"], feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        parts, points = [], []
        for polygon in polygons:
            for ring in polygon:
                coords = [project(*p[:2]) for p in ring]
                points.extend(coords)
                parts.append("M" + "L".join(f"{x},{y}" for x, y in coords) + "Z")
        xs, ys = zip(*points)
        result.append({
            "code": str(prop["CTPRVN_CD"] if level == "sido" else prop["SIG_CD"]),
            "parent": str(prop["CTPRVN_CD"]),
            "name": prop["CTP_KOR_NM"] if level == "sido" else prop["SIG_KOR_NM"],
            "fullName": prop.get("FULL_NM", prop.get("CTP_KOR_NM", "")),
            "path": "".join(parts),
            "bounds": [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)],
            "labelPoint": project(*representative_point(geometry)),
        })
    return result


def build(root):
    payload = {"sido": compile_features(root / "data/ctprvn.geojson", "sido"), "sigungu": compile_features(root / "data/sig.geojson", "sigungu")}
    target = root / "assets/maps.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Standalone vector assets are also available for reuse outside Streamlit.
    svg_dir = root / "assets/maps"
    svg_dir.mkdir(parents=True, exist_ok=True)
    def save_svg(name, features):
        boxes = [f["bounds"] for f in features]
        x, y = min(b[0] for b in boxes), min(b[1] for b in boxes)
        w, h = max(b[0]+b[2] for b in boxes)-x, max(b[1]+b[3] for b in boxes)-y
        paths = ''.join(f'<path data-code="{f["code"]}" d="{f["path"]}" fill="#adc6a7" stroke="white" stroke-width="1.2" vector-effect="non-scaling-stroke" fill-rule="evenodd"><title>{escape(f["fullName"] or f["name"])}</title></path>' for f in features)
        (svg_dir / name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {w} {h}">{paths}</svg>', encoding="utf-8")
    save_svg("korea.svg", payload["sido"])
    for sido in payload["sido"]:
        save_svg(f'sido_{sido["code"]}.svg', [f for f in payload["sigungu"] if f["parent"] == sido["code"]])
    return target


if __name__ == "__main__":
    print(build(Path(__file__).parent))

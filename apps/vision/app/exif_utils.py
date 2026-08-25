"""EXIF/GPS metadata extraction via Pillow — no extra dependency beyond what's already required for image handling."""
from io import BytesIO
from typing import Any

from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS


def _convert_to_degrees(value) -> float:
    d, m, s = value
    return float(d) + float(m) / 60.0 + float(s) / 3600.0


def extract_exif(image_bytes: bytes) -> dict[str, Any]:
    result: dict[str, Any] = {
        "cameraMake": None,
        "cameraModel": None,
        "dateTaken": None,
        "software": None,
        "gps": None,
        "width": None,
        "height": None,
    }
    try:
        img = Image.open(BytesIO(image_bytes))
        result["width"], result["height"] = img.size
        raw_exif = img.getexif()
        if not raw_exif:
            return result

        tags = {TAGS.get(k, k): v for k, v in raw_exif.items()}
        result["cameraMake"] = tags.get("Make")
        result["cameraModel"] = tags.get("Model")
        result["software"] = tags.get("Software")
        result["dateTaken"] = tags.get("DateTimeOriginal") or tags.get("DateTime")

        gps_info = raw_exif.get_ifd(0x8825)  # GPS IFD tag
        if gps_info:
            gps_tags = {GPSTAGS.get(k, k): v for k, v in gps_info.items()}
            lat = gps_tags.get("GPSLatitude")
            lat_ref = gps_tags.get("GPSLatitudeRef")
            lon = gps_tags.get("GPSLongitude")
            lon_ref = gps_tags.get("GPSLongitudeRef")
            if lat and lon:
                lat_deg = _convert_to_degrees(lat)
                lon_deg = _convert_to_degrees(lon)
                if lat_ref == "S":
                    lat_deg = -lat_deg
                if lon_ref == "W":
                    lon_deg = -lon_deg
                result["gps"] = {"lat": lat_deg, "lon": lon_deg}
    except Exception as exc:  # noqa: BLE001 — a malformed/non-image upload should degrade to "no EXIF", not 500
        result["error"] = str(exc)
    return result

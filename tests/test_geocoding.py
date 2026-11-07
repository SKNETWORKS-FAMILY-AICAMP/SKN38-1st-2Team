import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from geocoding import AddressSearchError, search_addresses


class GeocodingTests(unittest.TestCase):
    def test_demo_never_fabricates_unknown_addresses(self):
        rows = [{"addr": "서울특별시 관악구 낙성대로4가길 5", "statNm": "낙성대동주민센터", "lat": "37.476296", "lng": "126.9583876"}]
        self.assertEqual(search_addresses("없는도로 123", sample_rows=rows), [])
        result = search_addresses("낙성대로4가길", sample_rows=rows)
        self.assertEqual(result[0]["lat"], 37.476296)
        self.assertIn("데모", result[0]["source"])

    @patch("geocoding.urlopen")
    def test_kakao_candidates_coordinates_dedup_and_road_address(self, opener):
        doc = {"x": "126.9583876", "y": "37.476296", "road_address": {"address_name": "서울특별시 관악구 낙성대로4가길 5"}}
        bad = {"x": "NaN", "y": "Infinity", "address_name": "invalid"}
        opener.return_value = io.BytesIO(json.dumps({"documents": [doc, doc, bad]}).encode())
        results = search_addresses("낙성대로4가길", "test-key")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["lng"], 126.9583876)
        request = opener.call_args.args[0]
        self.assertIn("Authorization", request.headers)
        self.assertNotIn("test-key", request.full_url)

    @patch("geocoding.urlopen")
    def test_failed_auth_is_clear_and_does_not_expose_key(self, opener):
        opener.side_effect = HTTPError("url", 401, "private-error", {}, None)
        with self.assertRaises(AddressSearchError) as caught:
            search_addresses("낙성대로", "test-secret")
        self.assertIn("인증", str(caught.exception))
        self.assertNotIn("test-secret", str(caught.exception))

    @patch("geocoding.urlopen")
    def test_network_failure_does_not_silently_use_fake_location(self, opener):
        opener.side_effect = TimeoutError()
        with self.assertRaises(AddressSearchError):
            search_addresses("낙성대로", "test-key")


if __name__ == "__main__":
    unittest.main()

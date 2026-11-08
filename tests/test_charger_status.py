from datetime import datetime
from unittest import TestCase
from unittest.mock import Mock, patch

from services.charger_status import ChargerStatusError, recent_changes


def response(page, total, *items):
    rows = "".join(f"<item><statId>{station}</statId><chgerId>01</chgerId>"
                   f"<stat>{status}</stat><statUpdDt>{changed}</statUpdDt></item>"
                   for station, status, changed in items)
    metadata = (f"<pageNo>{page}</pageNo><numOfRows>2</numOfRows><totalCount>{total}</totalCount>"
                if page is not None else "")
    return Mock(content=(f"<response><header><resultCode>00</resultCode></header>"
                         f"<body>{metadata}<items>{rows}</items></body></response>").encode())


class ChargerStatusTest(TestCase):
    def test_nationwide_paging_with_overlap_and_conflict(self):
        first, later = "20261108120000", "20261108120100"
        pages = [response(1, 5, ("A", "2", first), ("B", "2", first)),
                 response(2, 6, ("A", "3", later), ("B", "3", first)),
                 response(3, 6, ("A", "2", first), ("C", "2", ""))]
        budget = Mock()
        with patch("services.charger_status.requests.get", side_effect=pages) as get:
            batch = recent_changes("demo", budget)
        self.assertEqual(batch.changes, {("A", "01"): ("3", datetime(2026, 11, 8, 12, 1))})
        self.assertEqual(batch.total_counts, (5, 6, 6))
        self.assertEqual((batch.ambiguous, batch.malformed), (1, 1))
        self.assertEqual(budget.call_count, 3)
        for page, call in enumerate(get.call_args_list, 1):
            self.assertEqual(call.kwargs["params"]["pageNo"], page)
            self.assertEqual(call.kwargs["params"]["period"], 10)
            self.assertNotIn("zcode", call.kwargs["params"])

    def test_empty_success(self):
        with patch("services.charger_status.requests.get", return_value=response(1, 0)):
            batch = recent_changes("demo", Mock())
        self.assertEqual((batch.pages, batch.received, batch.changes), (1, 0, {}))

    def test_missing_page_is_not_an_empty_success(self):
        first = "20261108120000"
        pages = [response(1, 3, ("A", "2", first), ("B", "2", first)), response(2, 3)]
        with patch("services.charger_status.requests.get", side_effect=pages):
            with self.assertRaises(ChargerStatusError):
                recent_changes("demo", Mock())

    def test_items_only_uses_empty_page_after_short_pages(self):
        first, later = "20261108120000", "20261108120100"
        pages = [response(None, None, ("A", "2", first), ("B", "2", first)),
                 response(None, None, ("A", "3", later), ("B", "3", first)),
                 response(None, None)]
        budget = Mock()
        with patch("services.charger_status.requests.get", side_effect=pages) as get:
            batch = recent_changes("demo", budget)
        self.assertEqual(batch.changes, {("A", "01"): ("3", datetime(2026, 11, 8, 12, 1))})
        self.assertEqual((batch.pages, batch.received, batch.total_counts, batch.ambiguous), (3, 4, (), 1))
        self.assertEqual(budget.call_count, 3)
        self.assertEqual([call.kwargs["params"]["pageNo"] for call in get.call_args_list], [1, 2, 3])

    def test_items_only_rejects_repeated_page_even_if_reordered(self):
        a, b = ("A", "2", "20261108120000"), ("B", "2", "20261108120000")
        pages = [response(None, None, a, b), response(None, None, b, a)]
        with patch("services.charger_status.requests.get", side_effect=pages):
            with self.assertRaisesRegex(ChargerStatusError, "이전 페이지를 반복"):
                recent_changes("demo", Mock())

    def test_items_only_rejects_missing_container(self):
        bad_page = Mock(content=b"<response><header><resultCode>00</resultCode></header><body/></response>")
        with patch("services.charger_status.requests.get", return_value=bad_page):
            with self.assertRaisesRegex(ChargerStatusError, "상태 목록 형식"):
                recent_changes("demo", Mock())

    def test_items_only_rejects_unfinished_batch_at_page_limit(self):
        pages = [response(None, None, ("A", "2", "20261108120000")),
                 response(None, None, ("B", "2", "20261108120000"))]
        with patch("services.charger_status.STATUS_PAGE_LIMIT", 2):
            with patch("services.charger_status.requests.get", side_effect=pages):
                with self.assertRaisesRegex(ChargerStatusError, "2페이지 내에 종료"):
                    recent_changes("demo", Mock())

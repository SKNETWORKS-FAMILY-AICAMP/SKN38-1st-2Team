"""Replaceable data-access boundary for sample CSV, API, or database data."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

import pandas as pd


class EVDataProvider(Protocol):
    def sido_metrics(self) -> pd.DataFrame: ...
    def sigungu_metrics(self, sido_code: str) -> pd.DataFrame: ...
    def stations(self, sigungu_code: str) -> pd.DataFrame: ...


class SampleCsvProvider:
    """Demo provider. Swap this class in app.py when the real API/DB is ready."""

    def __init__(self, data_dir: Path):
        dtype = {"sido_code": str, "sigungu_code": str}
        self._sido = pd.read_csv(data_dir / "sido_metrics.csv", dtype=dtype)
        self._sigungu = pd.read_csv(data_dir / "sigungu_metrics.csv", dtype=dtype)
        self._stations = pd.read_csv(data_dir / "stations.csv", dtype=dtype)

    def sido_metrics(self) -> pd.DataFrame:
        return self._sido.copy()

    def sigungu_metrics(self, sido_code: str) -> pd.DataFrame:
        return self._sigungu[self._sigungu.sido_code == str(sido_code)].copy()

    def stations(self, sigungu_code: str) -> pd.DataFrame:
        return self._stations[self._stations.sigungu_code == str(sigungu_code)].copy()


class ApiOrDatabaseProvider:
    """Integration seam: implement these methods and change one line in app.py."""

    def sido_metrics(self) -> pd.DataFrame:
        raise NotImplementedError("API/DB aggregate query goes here")

    def sigungu_metrics(self, sido_code: str) -> pd.DataFrame:
        raise NotImplementedError("API/DB regional aggregate query goes here")

    def stations(self, sigungu_code: str) -> pd.DataFrame:
        raise NotImplementedError("Live charger API query goes here")

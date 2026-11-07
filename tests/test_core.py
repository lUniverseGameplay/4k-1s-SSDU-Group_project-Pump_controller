import json
import unittest
from pathlib import Path
from typing import Any

from app.core import AnalysisError, analyze_json


DATA_DIR = Path(__file__).resolve().parents[1] / "data"


class AnalysisTests(unittest.TestCase):
    def analyze_file(self, name: str) -> dict[str, Any]:
        return analyze_json((DATA_DIR / name).read_bytes())

    def test_reference_duration_totals(self) -> None:
        expected = {
            "01_small.json": (12, 9, 3, 0, 0, {"low": 3, "normal": 3, "high": 3}),
            "02_boundaries.json": (8, 5, 3, 0, 0, {"low": 2, "normal": 2, "high": 1}),
            "03_gap_20min.json": (
                1800,
                600,
                0,
                1200,
                0,
                {"low": 0, "normal": 600, "high": 0},
            ),
            "04_invalid_values.json": (
                8,
                2,
                1,
                0,
                5,
                {"low": 0, "normal": 2, "high": 0},
            ),
            "05_long_record.json": (
                1800,
                1130,
                600,
                60,
                10,
                {"low": 300, "normal": 530, "high": 300},
            ),
            "06_empty.json": (0, 0, 0, 0, 0, {"low": 0, "normal": 0, "high": 0}),
            "07_single_point.json": (0, 0, 0, 0, 0, {"low": 0, "normal": 0, "high": 0}),
        }
        for filename, values in expected.items():
            with self.subTest(filename=filename):
                result = self.analyze_file(filename)
                self.assertEqual(
                    (
                        result["span_s"],
                        result["working_s"],
                        result["stopped_s"],
                        result["gap_s"],
                        result["invalid_s"],
                        result["modes_s"],
                    ),
                    values,
                )
                self.assertEqual(result["unknown_s"], result["gap_s"] + result["invalid_s"])
                self.assertEqual(len(result["hypotheses"]), 10)

    def test_invalid_reference_files_are_rejected_without_totals(self) -> None:
        cases = {
            "08_missing_rpm.json": "missing_field",
            "09_wrong_type.json": "wrong_type",
            "10_duplicate_time.json": "non_increasing_time",
        }
        for filename, category in cases.items():
            with self.subTest(filename=filename):
                with self.assertRaises(AnalysisError) as raised:
                    self.analyze_file(filename)
                self.assertEqual(raised.exception.category, category)

    def test_hypothesis_1_requires_full_five_minutes(self) -> None:
        samples = [
            {"t_s": second, "pressure_mpa": 2, "rpm": 80, "valid": True}
            for second in range(301)
        ]
        result = analyze_json(json.dumps(self.dataset(samples)))
        self.assertTrue(result["hypotheses"][0]["detected"])
        self.assertEqual(result["hypotheses"][0]["details"]["events"][0]["duration_s"], 300)

    def test_hypothesis_5_compares_matching_rpm_in_recording_edges(self) -> None:
        samples = []
        for second in range(101):
            pressure = 10 if second <= 20 else 8 if second >= 80 else 9
            samples.append(
                {"t_s": second, "pressure_mpa": pressure, "rpm": 100, "valid": True}
            )
        result = analyze_json(json.dumps(self.dataset(samples)))
        self.assertTrue(result["hypotheses"][4]["detected"])
        self.assertEqual(result["hypotheses"][4]["details"]["drop_percent"], 20)

    def test_hypothesis_10_detects_repeated_invalid_data_period(self) -> None:
        invalid_times = {1, 11, 21, 31}
        samples = [
            {
                "t_s": second,
                "pressure_mpa": 6,
                "rpm": 100,
                "valid": second not in invalid_times,
            }
            for second in range(36)
        ]
        result = analyze_json(json.dumps(self.dataset(samples)))
        hypothesis = result["hypotheses"][9]
        self.assertTrue(hypothesis["detected"])
        self.assertEqual(hypothesis["details"]["period_s"], 10)
        self.assertEqual(hypothesis["details"]["repetitions"], 3)

    def test_strict_stopped_ratio_boundary_is_not_an_anomaly(self) -> None:
        samples = [
            {
                "t_s": second,
                "pressure_mpa": 0 if second < 5 else 6,
                "rpm": 0 if second < 5 else 100,
                "valid": True,
            }
            for second in range(11)
        ]
        result = analyze_json(json.dumps(self.dataset(samples)))
        self.assertEqual(result["stopped_s"] / result["span_s"], 0.5)
        self.assertFalse(result["hypotheses"][1]["detected"])

    def test_hypotheses_report_event_times_for_sensor_anomalies(self) -> None:
        samples = [
            {"t_s": 0, "pressure_mpa": 2, "rpm": 100, "valid": True},
            {"t_s": 1, "pressure_mpa": 6, "rpm": 100, "valid": True},
            {"t_s": 5, "pressure_mpa": 12, "rpm": 130, "valid": True},
            {"t_s": 6, "pressure_mpa": 12, "rpm": 130, "valid": True},
        ]
        result = analyze_json(json.dumps(self.dataset(samples)))
        low_pressure = result["hypotheses"][6]
        recovery = result["hypotheses"][8]
        self.assertTrue(low_pressure["detected"])
        self.assertEqual(low_pressure["details"]["events"][0]["start_s"], 0)
        self.assertTrue(recovery["detected"])
        self.assertEqual(recovery["details"]["high_after_gap_times_s"], [5])

    def test_non_finite_and_boolean_numeric_values_are_rejected(self) -> None:
        for value in (True, 10**400):
            with self.subTest(value_type=type(value).__name__):
                sample = {"t_s": value, "pressure_mpa": 1, "rpm": 50, "valid": True}
                with self.assertRaises(AnalysisError) as raised:
                    analyze_json(json.dumps(self.dataset([sample])))
                self.assertEqual(raised.exception.category, "wrong_type")

    @staticmethod
    def dataset(samples: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "schema_version": "1.0",
            "dataset_id": "test",
            "synthetic": True,
            "samples": samples,
        }


if __name__ == "__main__":
    unittest.main()

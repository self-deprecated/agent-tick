#!/usr/bin/env python3
"""Unit tests for validate-mobile-eas-config.py."""

from __future__ import annotations

import copy
import importlib.util
import json
import unittest
from pathlib import Path
from types import ModuleType
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "scripts" / "validate-mobile-eas-config.py"
MOBILE = ROOT / "apps" / "mobile"


def load_validator() -> ModuleType:
    spec = importlib.util.spec_from_file_location("validate_mobile_eas_config", VALIDATOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load validator at {VALIDATOR_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


class MobileEASConfigValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.validator = load_validator()

    def setUp(self) -> None:
        self.app_json = load_json(MOBILE / "app.json")
        self.eas_json = load_json(MOBILE / "eas.json")
        self.package_json = load_json(MOBILE / "package.json")

    def errors_for(self, *, app_json: dict[str, Any] | None = None, eas_json: dict[str, Any] | None = None, package_json: dict[str, Any] | None = None) -> list[str]:
        return self.validator.validation_errors(
            self.app_json if app_json is None else app_json,
            self.eas_json if eas_json is None else eas_json,
            self.package_json if package_json is None else package_json,
        )

    def test_current_mobile_config_is_valid(self) -> None:
        self.assertEqual(self.errors_for(), [])

    def test_explicit_empty_inputs_are_validated(self) -> None:
        errors = self.errors_for(app_json={}, eas_json={}, package_json={})

        self.assertIn("app.json must define expo.extra.eas.projectId", errors)
        self.assertIn("eas.json build.development profile must be defined", errors)
        self.assertIn("package.json dependencies must include expo-dev-client", errors)

    def test_requires_preview_and_production_build_profiles(self) -> None:
        eas_json = copy.deepcopy(self.eas_json)
        del eas_json["build"]["preview"]
        del eas_json["build"]["production"]

        errors = self.errors_for(eas_json=eas_json)

        self.assertIn("eas.json build.preview profile must be defined", errors)
        self.assertIn("eas.json build.production profile must be defined", errors)

    def test_rejects_eas_update_channels_while_ota_is_disabled(self) -> None:
        eas_json = copy.deepcopy(self.eas_json)
        eas_json["build"]["production"]["channel"] = "production"

        errors = self.errors_for(eas_json=eas_json)

        self.assertIn("eas.json build.production.channel must be omitted while OTA updates are disabled", errors)

    def test_rejects_non_internal_preview_distribution(self) -> None:
        eas_json = copy.deepcopy(self.eas_json)
        eas_json["build"]["preview"]["distribution"] = "store"

        errors = self.errors_for(eas_json=eas_json)

        self.assertIn('eas.json build.preview.distribution must be "internal" for internal TestFlight/App Review smoke builds', errors)

    def test_rejects_production_development_client_or_internal_distribution(self) -> None:
        eas_json = copy.deepcopy(self.eas_json)
        eas_json["build"]["production"]["developmentClient"] = True
        eas_json["build"]["production"]["distribution"] = "internal"

        errors = self.errors_for(eas_json=eas_json)

        self.assertIn("eas.json build.production.developmentClient must not be true", errors)
        self.assertIn("eas.json build.production.distribution must be omitted or store-ready, not internal/simulator", errors)

    def test_rejects_missing_android_blocked_permissions(self) -> None:
        app_json = copy.deepcopy(self.app_json)
        app_json["expo"]["android"]["blockedPermissions"] = ["android.permission.RECORD_AUDIO"]

        errors = self.errors_for(app_json=app_json)

        self.assertIn("app.json android.blockedPermissions must remove transitive microphone, media/storage, overlay, startup, wake, reorder, and vibration permissions", errors)

    def test_rejects_expo_updates_package_and_app_config(self) -> None:
        app_json = copy.deepcopy(self.app_json)
        package_json = copy.deepcopy(self.package_json)
        app_json["expo"]["updates"] = {"url": "https://u.expo.dev/example"}
        app_json["expo"]["runtimeVersion"] = {"policy": "appVersion"}
        package_json["dependencies"]["expo-updates"] = "1.0.0"

        errors = self.errors_for(app_json=app_json, package_json=package_json)

        self.assertIn("app.json must not configure expo.updates for the initial App Store launch", errors)
        self.assertIn("app.json must not configure expo.runtimeVersion while OTA updates are disabled", errors)
        self.assertIn("package.json dependencies must not include expo-updates while OTA updates are disabled", errors)


if __name__ == "__main__":
    unittest.main()

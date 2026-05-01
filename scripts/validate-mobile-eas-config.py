#!/usr/bin/env python3
"""Validate mobile Expo/EAS development-build and update config."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOBILE = ROOT / "apps" / "mobile"


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def main() -> int:
    errors: list[str] = []

    app_json = load_json(MOBILE / "app.json")
    eas_json = load_json(MOBILE / "eas.json")
    package_json = load_json(MOBILE / "package.json")

    expo = app_json.get("expo", {})
    project_id = expo.get("extra", {}).get("eas", {}).get("projectId")
    updates_url = expo.get("updates", {}).get("url")

    require(isinstance(project_id, str) and len(project_id) > 0, "app.json must define expo.extra.eas.projectId", errors)
    require(
        updates_url == f"https://u.expo.dev/{project_id}",
        "app.json expo.updates.url must match expo.extra.eas.projectId",
        errors,
    )
    require(
        expo.get("runtimeVersion") == {"policy": "appVersion"},
        'app.json must set expo.runtimeVersion to {"policy": "appVersion"}',
        errors,
    )

    build = eas_json.get("build", {})
    expected_channels = {
        "development": "development",
        "preview": "preview",
        "production": "production",
    }
    for profile, channel in expected_channels.items():
        require(
            build.get(profile, {}).get("channel") == channel,
            f'eas.json build.{profile}.channel must be "{channel}"',
            errors,
        )

    require(
        build.get("development", {}).get("developmentClient") is True,
        "eas.json build.development.developmentClient must be true",
        errors,
    )
    require(
        build.get("development", {}).get("distribution") == "internal",
        'eas.json build.development.distribution must be "internal"',
        errors,
    )

    dependencies = package_json.get("dependencies", {})
    for dependency in ["expo-dev-client", "expo-updates"]:
        require(dependency in dependencies, f"package.json dependencies must include {dependency}", errors)

    if errors:
        for error in errors:
            print(f"mobile EAS config validation failed: {error}", file=sys.stderr)
        return 1

    print("mobile EAS config validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

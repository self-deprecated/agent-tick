#!/usr/bin/env python3
"""Validate mobile Expo/EAS production submission config."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MOBILE = ROOT / "apps" / "mobile"
EXPECTED_ANDROID_PERMISSIONS = ["android.permission.CAMERA"]
EXPECTED_ANDROID_BLOCKED_PERMISSIONS = [
    "android.permission.RECORD_AUDIO",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
    "android.permission.READ_MEDIA_AUDIO",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.SYSTEM_ALERT_WINDOW",
    "android.permission.REORDER_TASKS",
    "android.permission.RECEIVE_BOOT_COMPLETED",
    "android.permission.WAKE_LOCK",
    "android.permission.VIBRATE",
]


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def validation_errors(app_json: dict[str, Any], eas_json: dict[str, Any], package_json: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    expo = app_json.get("expo", {})
    project_id = expo.get("extra", {}).get("eas", {}).get("projectId") if isinstance(expo, dict) else None
    ios = expo.get("ios", {}) if isinstance(expo, dict) else {}
    android = expo.get("android", {}) if isinstance(expo, dict) else {}
    plugins = expo.get("plugins", []) if isinstance(expo, dict) else []

    def plugin_config(name: str) -> dict[str, Any] | None:
        for plugin in plugins if isinstance(plugins, list) else []:
            if plugin == name:
                return {}
            if isinstance(plugin, list) and plugin and plugin[0] == name:
                return plugin[1] if len(plugin) > 1 and isinstance(plugin[1], dict) else {}
        return None

    def purpose_is_specific(value: object, required_terms: list[str]) -> bool:
        if not isinstance(value, str) or not value.strip():
            return False
        lowered = value.lower()
        vague_fragments = ["access your", "biometric data", "use camera", "camera access", "needed"]
        return all(term in lowered for term in required_terms) and not any(fragment in lowered for fragment in vague_fragments)

    require(isinstance(project_id, str) and len(project_id) > 0, "app.json must define expo.extra.eas.projectId", errors)
    require(
        isinstance(expo, dict) and "updates" not in expo,
        "app.json must not configure expo.updates for the initial App Store launch",
        errors,
    )
    require(
        isinstance(expo, dict) and "runtimeVersion" not in expo,
        "app.json must not configure expo.runtimeVersion while OTA updates are disabled",
        errors,
    )

    build = eas_json.get("build", {})
    require(isinstance(build, dict), "eas.json build must be an object", errors)
    build_profiles = build if isinstance(build, dict) else {}
    for profile in ["development", "preview", "production"]:
        profile_config = build_profiles.get(profile)
        require(
            isinstance(profile_config, dict),
            f"eas.json build.{profile} profile must be defined",
            errors,
        )
        if isinstance(profile_config, dict):
            require(
                "channel" not in profile_config,
                f"eas.json build.{profile}.channel must be omitted while OTA updates are disabled",
                errors,
            )

    development = build_profiles.get("development") if isinstance(build_profiles.get("development"), dict) else {}
    preview = build_profiles.get("preview") if isinstance(build_profiles.get("preview"), dict) else {}
    production = build_profiles.get("production") if isinstance(build_profiles.get("production"), dict) else {}
    require(
        development.get("developmentClient") is True,
        "eas.json build.development.developmentClient must be true",
        errors,
    )
    require(
        development.get("distribution") == "internal",
        'eas.json build.development.distribution must be "internal"',
        errors,
    )
    require(
        preview.get("distribution") == "internal",
        'eas.json build.preview.distribution must be "internal" for internal TestFlight/App Review smoke builds',
        errors,
    )

    require(
        production.get("developmentClient") is not True,
        "eas.json build.production.developmentClient must not be true",
        errors,
    )
    require(
        production.get("distribution") not in {"internal", "simulator"},
        "eas.json build.production.distribution must be omitted or store-ready, not internal/simulator",
        errors,
    )

    ios_info = ios.get("infoPlist", {}) if isinstance(ios, dict) else {}
    require(
        isinstance(ios, dict) and ios.get("supportsTablet") is False,
        "app.json ios.supportsTablet must be false for the initial iPhone-only App Store launch",
        errors,
    )
    require(
        isinstance(ios_info, dict) and ios_info.get("ITSAppUsesNonExemptEncryption") is False,
        "app.json ios.infoPlist.ITSAppUsesNonExemptEncryption must be false unless export-compliance review changes",
        errors,
    )
    ats = ios_info.get("NSAppTransportSecurity", {}) if isinstance(ios_info, dict) else {}
    require(
        not (isinstance(ats, dict) and ats.get("NSAllowsArbitraryLoads") is True),
        "app.json ios.infoPlist.NSAppTransportSecurity must not set NSAllowsArbitraryLoads=true for production",
        errors,
    )
    require(
        isinstance(ios_info, dict) and "NSMicrophoneUsageDescription" not in ios_info,
        "app.json ios.infoPlist must not include NSMicrophoneUsageDescription because Agent Tick does not record audio",
        errors,
    )
    require(
        isinstance(ios_info, dict) and "NSFaceIDUsageDescription" not in ios_info,
        "app.json ios.infoPlist must not include NSFaceIDUsageDescription unless biometric authentication is intentionally enabled",
        errors,
    )

    camera = plugin_config("expo-camera")
    secure_store = plugin_config("expo-secure-store")
    clerk = plugin_config("@clerk/expo")
    notifications = plugin_config("expo-notifications")
    require(camera is not None, "app.json plugins must include expo-camera for QR pairing", errors)
    if camera is not None:
        require(
            purpose_is_specific(camera.get("cameraPermission"), ["agent tick", "scan", "pairing", "qr"]),
            "expo-camera cameraPermission must specifically mention Agent Tick QR pairing",
            errors,
        )
        require(camera.get("microphonePermission") is False, "expo-camera microphonePermission must be false", errors)
        require(camera.get("recordAudioAndroid") is False, "expo-camera recordAudioAndroid must be false", errors)
    require(
        isinstance(android, dict) and android.get("permissions") == EXPECTED_ANDROID_PERMISSIONS,
        "app.json android.permissions must only request CAMERA for QR pairing",
        errors,
    )
    require(
        isinstance(android, dict) and android.get("blockedPermissions") == EXPECTED_ANDROID_BLOCKED_PERMISSIONS,
        "app.json android.blockedPermissions must remove transitive microphone, media/storage, overlay, startup, wake, reorder, and vibration permissions",
        errors,
    )
    require(secure_store is not None, "app.json plugins must include expo-secure-store for secret storage", errors)
    if secure_store is not None:
        require(
            secure_store.get("faceIDPermission") is False,
            "expo-secure-store faceIDPermission must be false unless biometric authentication is intentionally enabled",
            errors,
        )
    require(notifications is not None, "app.json plugins must include expo-notifications for hosted push notifications", errors)
    require(clerk is not None and clerk.get("appleSignIn") is True, "@clerk/expo appleSignIn must be true for Sign in with Apple", errors)

    dependencies = package_json.get("dependencies", {})
    require(isinstance(dependencies, dict) and "expo-dev-client" in dependencies, "package.json dependencies must include expo-dev-client", errors)
    require(isinstance(dependencies, dict) and "expo-updates" not in dependencies, "package.json dependencies must not include expo-updates while OTA updates are disabled", errors)

    return errors


def main() -> int:
    errors = validation_errors(
        load_json(MOBILE / "app.json"),
        load_json(MOBILE / "eas.json"),
        load_json(MOBILE / "package.json"),
    )

    if errors:
        for error in errors:
            print(f"mobile EAS config validation failed: {error}", file=sys.stderr)
        return 1

    print("mobile EAS config validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

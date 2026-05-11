from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


EXPECTED_PHP_MINOR = "8.3"
EXPECTED_PLATFORM_PHP = "8.3.0"
EXPECTED_PHPUNIT_MAJOR = "^12.0"
REQUIRED_EXTENSIONS = ("curl", "json", "mbstring", "pdo", "pdo_mysql")
DOC_CONTRACT = (
    "Production requires PHP 8.3 or newer. CI validates API compatibility on PHP 8.3, "
    "the minimum supported production runtime."
)
TARGET_PHP_VERSION = (8, 3, 0)
VERSION_RE = re.compile(r"^(0|[1-9]\d*)(?:\.(0|[1-9]\d*|x|\*))(?:\.(0|[1-9]\d*|x|\*))?")


def load_json(path: Path, errors: list[str]) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        errors.append(f"{path.as_posix()} is missing")
    except json.JSONDecodeError as exc:
        errors.append(f"{path.as_posix()} is not valid JSON: {exc}")
    return {}


def read_text(path: Path, errors: list[str]) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        errors.append(f"{path.as_posix()} is missing")
        return ""


def parse_version(value: str) -> tuple[int, int, int] | None:
    match = VERSION_RE.match(value.strip().lower().lstrip("v"))
    if match is None:
        return None
    parts: list[int] = []
    for raw in match.groups():
        if raw is None or raw in {"x", "*"}:
            parts.append(0)
        else:
            parts.append(int(raw))
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def compare_versions(left: tuple[int, int, int], right: tuple[int, int, int]) -> int:
    return (left > right) - (left < right)


def version_token_allows_target(token: str) -> bool:
    token = token.strip()
    if token in {"", "*"}:
        return True

    if token.startswith("!="):
        forbidden = token[2:].strip()
        if forbidden.endswith((".*", ".x")):
            prefix = tuple(int(part) for part in re.split(r"[.*x]+", forbidden) if part != "")
            return TARGET_PHP_VERSION[: len(prefix)] != prefix
        parsed = parse_version(forbidden)
        return parsed is None or TARGET_PHP_VERSION != parsed

    operator = "="
    version_text = token
    for candidate in (">=", "<=", ">", "<", "==", "="):
        if token.startswith(candidate):
            operator = candidate
            version_text = token[len(candidate):].strip()
            break

    if version_text.startswith("^"):
        lower = parse_version(version_text[1:])
        if lower is None or compare_versions(TARGET_PHP_VERSION, lower) < 0:
            return False
        upper = (lower[0] + 1, 0, 0) if lower[0] > 0 else (0, lower[1] + 1, 0)
        return compare_versions(TARGET_PHP_VERSION, upper) < 0

    if version_text.startswith("~"):
        lower = parse_version(version_text[1:])
        if lower is None or compare_versions(TARGET_PHP_VERSION, lower) < 0:
            return False
        upper = (lower[0], lower[1] + 1, 0) if version_text[1:].count(".") >= 2 else (lower[0] + 1, 0, 0)
        return compare_versions(TARGET_PHP_VERSION, upper) < 0

    if version_text.endswith((".*", ".x")):
        prefix = tuple(int(part) for part in re.split(r"[.*x]+", version_text.lower()) if part != "")
        return TARGET_PHP_VERSION[: len(prefix)] == prefix

    parsed = parse_version(version_text)
    if parsed is None:
        return False

    comparison = compare_versions(TARGET_PHP_VERSION, parsed)
    if operator == ">=":
        return comparison >= 0
    if operator == ">":
        return comparison > 0
    if operator == "<=":
        return comparison <= 0
    if operator == "<":
        return comparison < 0
    return comparison == 0


def php_requirement_allows_target(requirement: Any) -> bool:
    if not isinstance(requirement, str) or requirement.strip() == "":
        return True

    alternatives = [part.strip() for part in requirement.split("||")]
    for alternative in alternatives:
        tokens = [token for token in re.split(r"[\s,]+", alternative) if token]
        if tokens and all(version_token_allows_target(token) for token in tokens):
            return True
    return False


def validate_dockerfile(root: Path, errors: list[str]) -> None:
    dockerfile = read_text(root / "api" / "Dockerfile", errors)
    if "FROM php:8.3-apache AS base" not in dockerfile:
        errors.append("api/Dockerfile must use php:8.3-apache as the base API runtime")
    for extension in ("curl", "mbstring", "pdo_mysql"):
        if extension not in dockerfile:
            errors.append(f"api/Dockerfile must install the {extension} PHP extension")


def validate_composer_json(root: Path, errors: list[str]) -> None:
    composer = load_json(root / "api" / "composer.json", errors)
    require = composer.get("require", {})
    require_dev = composer.get("require-dev", {})
    config = composer.get("config", {})
    platform = config.get("platform", {}) if isinstance(config, dict) else {}

    if require.get("php") != "^8.3":
        errors.append("api/composer.json must require php ^8.3")
    for extension in REQUIRED_EXTENSIONS:
        if require.get(f"ext-{extension}") != "*":
            errors.append(f"api/composer.json must require ext-{extension}")
    if require_dev.get("phpunit/phpunit") != EXPECTED_PHPUNIT_MAJOR:
        errors.append(f"api/composer.json must require phpunit/phpunit {EXPECTED_PHPUNIT_MAJOR}")
    if platform.get("php") != EXPECTED_PLATFORM_PHP:
        errors.append(f"api/composer.json config.platform.php must be {EXPECTED_PLATFORM_PHP}")


def validate_composer_lock(root: Path, errors: list[str]) -> None:
    lock = load_json(root / "api" / "composer.lock", errors)
    platform = lock.get("platform", {})
    platform_overrides = lock.get("platform-overrides", {})

    if platform.get("php") != "^8.3":
        errors.append("api/composer.lock platform must include php ^8.3; regenerate the lockfile")
    for extension in REQUIRED_EXTENSIONS:
        if platform.get(f"ext-{extension}") != "*":
            errors.append(f"api/composer.lock platform must include ext-{extension}; regenerate the lockfile")
    if platform_overrides.get("php") != EXPECTED_PLATFORM_PHP:
        errors.append(f"api/composer.lock platform-overrides.php must be {EXPECTED_PLATFORM_PHP}")

    for section in ("packages", "packages-dev"):
        packages = lock.get(section, [])
        if not isinstance(packages, list):
            continue
        for package in packages:
            name = package.get("name", "<unknown>")
            php_requirement = package.get("require", {}).get("php")
            if not php_requirement_allows_target(php_requirement):
                errors.append(f"api/composer.lock locks {name} with PHP requirement {php_requirement!r} that does not allow PHP {EXPECTED_PLATFORM_PHP}")


def workflow_job_block(workflow: str, job_name: str) -> str:
    match = re.search(rf"(?ms)^  {re.escape(job_name)}:\n(?P<body>.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)", workflow)
    return match.group("body") if match else ""


def require_pattern(block: str, pattern: str, description: str, errors: list[str]) -> None:
    if re.search(pattern, block, flags=re.MULTILINE) is None:
        errors.append(f".github/workflows/ci.yml must include {description}")


def validate_workflow(root: Path, errors: list[str]) -> None:
    workflow = read_text(root / ".github" / "workflows" / "ci.yml", errors)
    workflow_config = workflow_job_block(workflow, "workflow-config")
    api = workflow_job_block(workflow, "api")
    deploy_payload = workflow_job_block(workflow, "deploy-payload")

    if workflow_config == "":
        errors.append(".github/workflows/ci.yml must define a workflow-config job")
    if api == "":
        errors.append(".github/workflows/ci.yml must define an api job")
    if deploy_payload == "":
        errors.append(".github/workflows/ci.yml must define a deploy-payload job")

    require_pattern(
        workflow_config,
        r"^\s*(?:-\s*)?run:\s*python3 \.github/scripts/validate_php_runtime_contract\.py\s*$",
        "workflow-config PHP runtime contract validation",
        errors,
    )
    require_pattern(
        api,
        r"^\s*(?:-\s*)?run:\s*docker compose run --rm test php -r .*Expected PHP 8\.3",
        "api job PHP 8.3 runtime assertion",
        errors,
    )
    require_pattern(
        api,
        r"^\s*(?:-\s*)?run:\s*docker compose run --rm test composer validate --strict --no-check-publish\s*$",
        "api job Composer strict validation",
        errors,
    )
    require_pattern(
        api,
        r"^\s*(?:-\s*)?run:\s*docker compose run --rm test composer check-platform-reqs --lock\s*$",
        "api job full Composer platform check",
        errors,
    )
    require_pattern(
        deploy_payload,
        r"^\s*php-version:\s*'8\.3'\s*$",
        "deploy-payload PHP 8.3 setup",
        errors,
    )
    require_pattern(
        deploy_payload,
        r"^\s*(?:-\s*)?run:\s*php -r .*Expected PHP 8\.3",
        "deploy-payload PHP 8.3 runtime assertion",
        errors,
    )
    require_pattern(
        deploy_payload,
        r"^\s*composer check-platform-reqs --lock --no-dev\s*$",
        "deploy-payload production Composer platform check",
        errors,
    )


def validate_docs(root: Path, errors: list[str]) -> None:
    for relative in ("docs/DEVELOPMENT.md", "docs/DEPLOYMENT.md"):
        text = read_text(root / relative, errors)
        if DOC_CONTRACT not in text:
            errors.append(f"{relative} must state the PHP 8.3 production compatibility contract")


def validation_errors(root: Path) -> list[str]:
    errors: list[str] = []
    validate_dockerfile(root, errors)
    validate_composer_json(root, errors)
    validate_composer_lock(root, errors)
    validate_workflow(root, errors)
    validate_docs(root, errors)
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the PHP runtime/dependency version contract.")
    parser.add_argument("--root", default=".", type=Path)
    args = parser.parse_args()

    errors = validation_errors(args.root.resolve())
    if errors:
        for error in errors:
            print(f"::error::{error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

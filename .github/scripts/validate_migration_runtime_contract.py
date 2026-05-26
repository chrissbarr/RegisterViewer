from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


def read_text(path: Path, errors: list[str]) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        errors.append(f"{path.as_posix()} is missing")
        return ""


def require(text: str, fragment: str, source: str, errors: list[str]) -> None:
    if fragment not in text:
        errors.append(f"{source} must contain {fragment!r}")


def workflow_job_block(workflow: str, job_name: str) -> str:
    match = re.search(rf"(?ms)^  {re.escape(job_name)}:\n(?P<body>.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)", workflow)
    return match.group("body") if match else ""


def workflow_step_block(job_block: str, step_name: str) -> str:
    match = re.search(
        rf"(?ms)^      - name:\s*{re.escape(step_name)}\s*\n(?P<body>.*?)(?=^      - (?:name:|uses:)|\Z)",
        job_block,
    )
    return match.group("body") if match else ""


def require_pattern(block: str, pattern: str, source: str, description: str, errors: list[str]) -> None:
    if re.search(pattern, block, flags=re.MULTILINE) is None:
        errors.append(f"{source} must include {description}")


def require_block(block: str, fragment: str, source: str, description: str, errors: list[str]) -> None:
    if fragment not in block:
        errors.append(f"{source} must include {description}")


def validate_runtime(root: Path, errors: list[str]) -> None:
    index = read_text(root / "api" / "index.php", errors)
    response = read_text(root / "api" / "src" / "api-response.php", errors)
    migrate = read_text(root / "api" / "database" / "migrate.php", errors)

    require(index, "require __DIR__ . '/database/migrate.php';", "api/index.php", errors)
    require(index, "ensureSchemaReady($db, $migrationsDir, $migrationLockFile)", "api/index.php", errors)
    require(index, "emitResponse(schemaNotReadyResponse())", "api/index.php", errors)
    require(index, "'migrations' => 'ready'", "api/index.php", errors)
    require(index, "'appliedMigrations' =>", "api/index.php", errors)
    require(index, "'pendingMigrations' =>", "api/index.php", errors)
    for key in ("projects.version", "login_codes.code_verifier", "auth_rate_limits.scope"):
        require(index, key, "api/index.php", errors)

    require(response, "function schemaNotReadyResponse(): ApiResponse", "api/src/api-response.php", errors)
    require(response, "'Retry-After' => '5'", "api/src/api-response.php", errors)

    for fragment in (
        "function getSchemaReadiness(PDO $db, string $migrationsDir): array",
        "function ensureSchemaReady(PDO $db, string $migrationsDir, string $lockFile): array",
        "No numbered migration files found",
        "Duplicate migration version %d: %s and %s",
        "Migration %d filename mismatch: expected %s, found %s",
        "Migration %d checksum mismatch for %s",
        "Applied migration %d has no deployed migration file: %s",
        "pendingMigrations",
        "appliedMigrations",
        "migrationHistoryErrors",
        "Unable to open migration lock file",
        "Schema migration is already in progress",
        "projects.version",
        "login_codes.code_verifier",
        "auth_rate_limits(scope",
    ):
        require(migrate, fragment, "api/database/migrate.php", errors)


def validate_workflows(root: Path, errors: list[str]) -> None:
    ci = read_text(root / ".github" / "workflows" / "ci.yml", errors)
    deploy = read_text(root / ".github" / "workflows" / "deploy.yml", errors)

    workflow_config = workflow_job_block(ci, "workflow-config")
    api = workflow_job_block(ci, "api")
    deploy_payload = workflow_job_block(ci, "deploy-payload")
    deploy_job = workflow_job_block(deploy, "deploy")

    if workflow_config == "":
        errors.append(".github/workflows/ci.yml must define a workflow-config job")
    if api == "":
        errors.append(".github/workflows/ci.yml must define an api job")
    if deploy_payload == "":
        errors.append(".github/workflows/ci.yml must define a deploy-payload job")
    if deploy_job == "":
        errors.append(".github/workflows/deploy.yml must define a deploy job")

    require_pattern(
        workflow_config,
        r"^\s*(?:-\s*)?run:\s*python3 \.github/scripts/validate_migration_runtime_contract\.py\s*$",
        ".github/workflows/ci.yml",
        "workflow-config migration runtime contract validation",
        errors,
    )

    api_migration_test = workflow_step_block(api, "Run migrations and tests")
    if api_migration_test == "":
        errors.append(".github/workflows/ci.yml api job must define a Run migrations and tests step")
    require_pattern(
        api_migration_test,
        r'^\s*run:\s*docker compose run --rm test bash -c "php database/migrate\.php && vendor/bin/phpunit"\s*$',
        ".github/workflows/ci.yml",
        "api migration runner before PHPUnit",
        errors,
    )

    ci_payload_validation = workflow_step_block(deploy_payload, "Validate deploy payload")
    if ci_payload_validation == "":
        errors.append(".github/workflows/ci.yml deploy-payload job must define a Validate deploy payload step")
    require_block(
        ci_payload_validation,
        '"deploy/api/database/migrate.php"',
        ".github/workflows/ci.yml",
        "deploy-payload migrate.php payload validation",
        errors,
    )
    require_block(
        ci_payload_validation,
        "Deploy payload must include numbered database migrations",
        ".github/workflows/ci.yml",
        "deploy-payload numbered migration payload validation",
        errors,
    )

    deploy_payload_validation = workflow_step_block(deploy_job, "Verify deploy payload")
    if deploy_payload_validation == "":
        errors.append(".github/workflows/deploy.yml deploy job must define a Verify deploy payload step")
    require_block(
        deploy_payload_validation,
        '"deploy/api/database/migrate.php"',
        ".github/workflows/deploy.yml",
        "downloaded payload migrate.php validation",
        errors,
    )
    require_block(
        deploy_payload_validation,
        "Deploy payload must include numbered database migrations",
        ".github/workflows/deploy.yml",
        "downloaded payload numbered migration validation",
        errors,
    )

    deploy_smoke = workflow_step_block(deploy_job, "Post-deploy smoke test")
    if deploy_smoke == "":
        errors.append(".github/workflows/deploy.yml deploy job must define a Post-deploy smoke test step")
    for fragment, description in (
        ('health.get("migrations") != "ready"', "health migrations-ready smoke check"),
        ('health.get("pendingMigrations") != []', "health pending-migrations smoke check"),
        ("expected_versions = set()", "artifact migration version collection"),
        ("missing = sorted(expected_versions - applied)", "missing applied migration comparison"),
        ("extra = sorted(applied - expected_versions)", "extra applied migration comparison"),
    ):
        require_block(deploy_smoke, fragment, ".github/workflows/deploy.yml", description, errors)


def validate_docs(root: Path, errors: list[str]) -> None:
    api = read_text(root / "docs" / "API.md", errors)
    deployment = read_text(root / "docs" / "DEPLOYMENT.md", errors)
    development = read_text(root / "docs" / "DEVELOPMENT.md", errors)

    for fragment in (
        "GET /api/health",
        "verifies every numbered migration",
        "schema_not_ready",
        "config_not_ready",
        "Retry-After: 5",
        "appliedMigrations",
        "pendingMigrations",
        "projects.version",
        "login_codes.code_verifier",
        "auth_rate_limits.scope",
    ):
        require(api, fragment, "docs/API.md", errors)

    for fragment in (
        "Do not import individual migration files during normal setup",
        "runs all numbered migrations",
        "hard pre-routing readiness step",
        "api/database/.migrate.lock",
        "matching filename and checksum",
        "Do not edit an already-applied migration file",
        "every numbered migration version shipped in the deploy artifact",
    ):
        require(deployment, fragment, "docs/DEPLOYMENT.md", errors)

    for fragment in (
        "The PHP migration runner owns local schema creation",
        "php database/migrate.php",
        "api/database/.migrate.lock",
        "add a new numbered migration",
    ):
        require(development, fragment, "docs/DEVELOPMENT.md", errors)


def validation_errors(root: Path) -> list[str]:
    errors: list[str] = []
    validate_runtime(root, errors)
    validate_workflows(root, errors)
    validate_docs(root, errors)
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the API migration/readiness runtime contract.")
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

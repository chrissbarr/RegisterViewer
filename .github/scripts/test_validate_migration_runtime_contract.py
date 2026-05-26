from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from validate_migration_runtime_contract import validation_errors


class ValidateMigrationRuntimeContractTest(unittest.TestCase):
    def make_files(self) -> dict[str, str]:
        return {
            "api/index.php": "\n".join([
                "require __DIR__ . '/database/migrate.php';",
                "ensureSchemaReady($db, $migrationsDir, $migrationLockFile)",
                "emitResponse(schemaNotReadyResponse())",
                "'migrations' => 'ready'",
                "'appliedMigrations' =>",
                "'pendingMigrations' =>",
                "projects.version",
                "login_codes.code_verifier",
                "auth_rate_limits.scope",
            ]),
            "api/src/api-response.php": "\n".join([
                "function schemaNotReadyResponse(): ApiResponse",
                "'Retry-After' => '5'",
            ]),
            "api/database/migrate.php": "\n".join([
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
            ]),
            ".github/workflows/ci.yml": """
name: CI
jobs:
  workflow-config:
    steps:
      - run: python3 -m unittest discover -s .github/scripts -p 'test_*.py'
      - run: python3 .github/scripts/validate_migration_runtime_contract.py
  api:
    steps:
      - name: Run migrations and tests
        run: docker compose run --rm test bash -c "php database/migrate.php && vendor/bin/phpunit"
  deploy-payload:
    steps:
      - name: Validate deploy payload
        run: |
          test -f "deploy/api/database/migrate.php"
          if ! find deploy/api/database/migrations -maxdepth 1 -type f -name '[0-9]*_*.sql' -print -quit | grep -q .; then
            echo "::error::Deploy payload must include numbered database migrations"
            exit 1
          fi
""",
            ".github/workflows/deploy.yml": """
name: Deploy to cPanel
jobs:
  deploy:
    steps:
      - name: Verify deploy payload
        run: |
          test -f "deploy/api/database/migrate.php"
          if ! find deploy/api/database/migrations -maxdepth 1 -type f -name '[0-9]*_*.sql' -print -quit | grep -q .; then
            echo "::error::Deploy payload must include numbered database migrations"
            exit 1
          fi
      - name: Post-deploy smoke test
        run: |
          if health.get("migrations") != "ready":
              errors.append("migrations are not ready")
          if health.get("pendingMigrations") != []:
              errors.append("health reports pending migrations")
          expected_versions = set()
          missing = sorted(expected_versions - applied)
          extra = sorted(applied - expected_versions)
""",
            "docs/API.md": "\n".join([
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
            ]),
            "docs/DEPLOYMENT.md": "\n".join([
                "Do not import individual migration files during normal setup",
                "runs all numbered migrations",
                "hard pre-routing readiness step",
                "api/database/.migrate.lock",
                "matching filename and checksum",
                "Do not edit an already-applied migration file",
                "every numbered migration version shipped in the deploy artifact",
            ]),
            "docs/DEVELOPMENT.md": "\n".join([
                "The PHP migration runner owns local schema creation",
                "php database/migrate.php",
                "api/database/.migrate.lock",
                "add a new numbered migration",
            ]),
        }

    def run_validation(self, files: dict[str, str]) -> list[str]:
        def read_text(path: Path, encoding: str = "utf-8") -> str:
            del encoding
            normalized = path.as_posix()
            for relative, text in files.items():
                if normalized.endswith(relative):
                    return text
            raise FileNotFoundError(normalized)

        with patch("validate_migration_runtime_contract.Path.read_text", read_text):
            return validation_errors(Path("repo"))

    def test_accepts_consistent_contract(self) -> None:
        self.assertEqual([], self.run_validation(self.make_files()))

    def test_rejects_missing_runtime_gate(self) -> None:
        files = self.make_files()
        files["api/index.php"] = files["api/index.php"].replace(
            "ensureSchemaReady($db, $migrationsDir, $migrationLockFile)",
            "",
        )

        self.assertTrue(any("api/index.php" in error for error in self.run_validation(files)))

    def test_rejects_missing_deploy_health_migration_comparison(self) -> None:
        files = self.make_files()
        files[".github/workflows/deploy.yml"] = files[".github/workflows/deploy.yml"].replace(
            "missing = sorted(expected_versions - applied)",
            "",
        )

        self.assertTrue(any(".github/workflows/deploy.yml" in error for error in self.run_validation(files)))

    def test_rejects_validator_command_outside_workflow_config(self) -> None:
        files = self.make_files()
        files[".github/workflows/ci.yml"] = files[".github/workflows/ci.yml"].replace(
            "      - run: python3 .github/scripts/validate_migration_runtime_contract.py\n",
            "",
        ).replace(
            "  api:\n    steps:\n",
            "  api:\n    steps:\n      - run: python3 .github/scripts/validate_migration_runtime_contract.py\n",
        )

        self.assertTrue(any("workflow-config migration runtime contract validation" in error for error in self.run_validation(files)))

    def test_rejects_migration_history_checksum_check_removed(self) -> None:
        files = self.make_files()
        files["api/database/migrate.php"] = files["api/database/migrate.php"].replace(
            "Migration %d checksum mismatch for %s",
            "",
        )

        self.assertTrue(any("checksum mismatch" in error for error in self.run_validation(files)))

    def test_rejects_missing_docs_lock_guidance(self) -> None:
        files = self.make_files()
        files["docs/DEPLOYMENT.md"] = files["docs/DEPLOYMENT.md"].replace(
            "api/database/.migrate.lock",
            "",
        )

        self.assertTrue(any("docs/DEPLOYMENT.md" in error for error in self.run_validation(files)))

    def test_rejects_missing_schema_not_ready_retry_after_docs(self) -> None:
        files = self.make_files()
        files["docs/API.md"] = files["docs/API.md"].replace("Retry-After: 5", "")

        self.assertTrue(any("docs/API.md" in error for error in self.run_validation(files)))


if __name__ == "__main__":
    unittest.main()

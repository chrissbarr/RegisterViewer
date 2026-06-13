from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch

from validate_php_runtime_contract import php_requirement_allows_target, validation_errors


class ValidatePhpRuntimeContractTest(unittest.TestCase):
    def make_files(self) -> dict[str, str]:
        doc_contract = (
            "Production requires PHP 8.5 or newer. CI validates API compatibility on PHP 8.5, "
            "the minimum supported production runtime."
        )
        return {
            "api/Dockerfile": "FROM php:8.5-apache AS base\nRUN docker-php-ext-install curl mbstring pdo_mysql\n",
            "api/composer.json": json.dumps(
                {
                    "require": {
                        "php": "^8.5",
                        "ext-curl": "*",
                        "ext-json": "*",
                        "ext-mbstring": "*",
                        "ext-pdo": "*",
                        "ext-pdo_mysql": "*",
                        "firebase/php-jwt": "^7.0",
                    },
                    "require-dev": {"phpunit/phpunit": "^13.0"},
                    "config": {"platform": {"php": "8.5.0"}},
                }
            ),
            "api/composer.lock": json.dumps(
                {
                    "packages": [
                        {"name": "firebase/php-jwt", "require": {"php": "^8.0"}},
                    ],
                    "packages-dev": [
                        {"name": "phpunit/phpunit", "require": {"php": ">=8.4"}},
                    ],
                    "platform": {
                        "php": "^8.5",
                        "ext-curl": "*",
                        "ext-json": "*",
                        "ext-mbstring": "*",
                        "ext-pdo": "*",
                        "ext-pdo_mysql": "*",
                    },
                    "platform-overrides": {"php": "8.5.0"},
                }
            ),
            ".github/workflows/ci.yml": """
name: CI
jobs:
  workflow-config:
    steps:
      - run: python3 .github/scripts/validate_php_runtime_contract.py
  api:
    steps:
      - run: docker compose run --rm test php -r 'if (PHP_MAJOR_VERSION !== 8 || PHP_MINOR_VERSION !== 5) { fwrite(STDERR, "Expected PHP 8.5"); exit(1); }'
      - run: docker compose run --rm test composer validate --strict --no-check-publish
      - run: docker compose run --rm test composer check-platform-reqs --lock
  deploy-payload:
    steps:
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.5'
      - run: php -r 'if (PHP_MAJOR_VERSION !== 8 || PHP_MINOR_VERSION !== 5) { fwrite(STDERR, "Expected PHP 8.5"); exit(1); }'
      - run: |
          composer validate --strict --no-check-publish
          composer check-platform-reqs --lock --no-dev
""",
            "docs/DEVELOPMENT.md": doc_contract,
            "docs/DEPLOYMENT.md": doc_contract,
        }

    def run_validation(self, files: dict[str, str]) -> list[str]:
        def read_text(path: Path, encoding: str = "utf-8") -> str:
            del encoding
            normalized = path.as_posix()
            for relative, text in files.items():
                if normalized.endswith(relative):
                    return text
            raise FileNotFoundError(normalized)

        with patch("validate_php_runtime_contract.Path.read_text", read_text):
            return validation_errors(Path("repo"))

    def test_accepts_consistent_php85_contract(self) -> None:
        self.assertEqual([], self.run_validation(self.make_files()))

    def test_rejects_php84_docker_base(self) -> None:
        files = self.make_files()
        files["api/Dockerfile"] = "FROM php:8.4-apache AS base\nRUN docker-php-ext-install curl mbstring pdo_mysql\n"

        self.assertTrue(any("php:8.5-apache" in error for error in self.run_validation(files)))

    def test_rejects_lockfile_requiring_newer_php(self) -> None:
        files = self.make_files()
        lock = json.loads(files["api/composer.lock"])
        lock["packages-dev"][0] = {"name": "phpunit/phpunit", "require": {"php": ">=8.6.1"}}
        files["api/composer.lock"] = json.dumps(lock)

        self.assertTrue(any("phpunit/phpunit" in error for error in self.run_validation(files)))

    def test_rejects_missing_doc_contract(self) -> None:
        files = self.make_files()
        files["docs/DEVELOPMENT.md"] = "PHP 8.5+"

        self.assertTrue(any("docs/DEVELOPMENT.md" in error for error in self.run_validation(files)))

    def test_php_requirement_checker_uses_php85_allowance(self) -> None:
        self.assertTrue(php_requirement_allows_target("^8.0"))
        self.assertTrue(php_requirement_allows_target("^7.4 || ^8.0"))
        self.assertTrue(php_requirement_allows_target(">=8.5 <8.6"))
        self.assertTrue(php_requirement_allows_target("!=8.6.* >=8.5"))
        self.assertFalse(php_requirement_allows_target(">=8.6.1"))
        self.assertFalse(php_requirement_allows_target("^9.0"))

    def test_rejects_api_platform_check_only_present_in_deploy_payload(self) -> None:
        files = self.make_files()
        files[".github/workflows/ci.yml"] = files[".github/workflows/ci.yml"].replace(
            "      - run: docker compose run --rm test composer check-platform-reqs --lock\n",
            "",
        )

        self.assertTrue(any("api job full Composer platform check" in error for error in self.run_validation(files)))


if __name__ == "__main__":
    unittest.main()

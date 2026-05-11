from __future__ import annotations

import os
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import Mock, mock_open, patch

from validate_vite_api_url import main, validation_errors


class ValidateViteApiUrlTest(unittest.TestCase):
    def assertValid(self, value: str) -> None:
        self.assertEqual([], validation_errors(value))

    def assertInvalid(self, value: str) -> None:
        self.assertNotEqual([], validation_errors(value))

    def test_accepts_canonical_https_origins(self) -> None:
        self.assertValid("https://www.registerviewer.com")
        self.assertValid("https://api.registerviewer.com:8443")

    def test_rejects_missing_or_non_https_values(self) -> None:
        self.assertInvalid("")
        self.assertInvalid("http://www.registerviewer.com")
        self.assertInvalid("HTTPS://www.registerviewer.com")
        self.assertInvalid("https://")

    def test_rejects_non_origin_values(self) -> None:
        self.assertInvalid("https://www.registerviewer.com/")
        self.assertInvalid("https://www.registerviewer.com/api")
        self.assertInvalid("https://www.registerviewer.com?x=1")
        self.assertInvalid("https://www.registerviewer.com?")
        self.assertInvalid("https://www.registerviewer.com#fragment")
        self.assertInvalid("https://www.registerviewer.com#")
        self.assertInvalid("https://user:pass@www.registerviewer.com")

    def test_rejects_non_canonical_or_malformed_values(self) -> None:
        self.assertInvalid(" https://www.registerviewer.com")
        self.assertInvalid("https://www.registerviewer.com ")
        self.assertInvalid("https://www.registerviewer.com\\api")
        self.assertInvalid("https://www.registerviewer.com:bad")
        self.assertInvalid("https://www.registerviewer.com:0")
        self.assertInvalid("https://www.registerviewer.com:443")
        self.assertInvalid("https://WWW.REGISTERVIEWER.COM")
        self.assertInvalid("https://[::1")
        self.assertInvalid("https://[gggg::1]")
        self.assertInvalid("https://exa_mple.com")
        self.assertInvalid("https://-example.com")
        self.assertInvalid("https://example..com")

    def test_rejects_local_or_reserved_hosts(self) -> None:
        self.assertInvalid("https://localhost")
        self.assertInvalid("https://localhost.")
        self.assertInvalid("https://127.0.0.1")
        self.assertInvalid("https://127.1")
        self.assertInvalid("https://2130706433")
        self.assertInvalid("https://0177.0.0.1")
        self.assertInvalid("https://0x7f.0.0.1")
        self.assertInvalid("https://127.0x0.0.1")
        self.assertInvalid("https://0xc0.0xa8.0x01.0x01")
        self.assertInvalid("https://10.0.0.1")
        self.assertInvalid("https://100.64.0.1")
        self.assertInvalid("https://224.0.0.1")
        self.assertInvalid("https://test")
        self.assertInvalid("https://local")
        self.assertInvalid("https://invalid")
        self.assertInvalid("https://example")
        self.assertInvalid("https://example.com")
        self.assertInvalid("https://api.example.com")
        self.assertInvalid("https://mock-cloud-api.test")
        self.assertInvalid("https://mock-cloud-api.test.")
        self.assertInvalid("https://service.local")
        self.assertInvalid("https://service.example")
        self.assertInvalid("https://" + ".".join(["a" * 63, "b" * 63, "c" * 63, "d" * 61]) + ".com")

    def test_main_writes_github_output_for_valid_input(self) -> None:
        opened = mock_open()
        with patch.dict(os.environ, {"GITHUB_OUTPUT": "github-output"}, clear=False):
            with patch("validate_vite_api_url.Path.open", opened):
                with patch("sys.argv", ["validate_vite_api_url.py", "--value", "https://www.registerviewer.com"]):
                    self.assertEqual(0, main())

        opened.assert_called_once_with("a", encoding="utf-8")
        opened().write.assert_called_once_with("origin=https://www.registerviewer.com\n")

    def test_main_does_not_write_github_output_for_invalid_input(self) -> None:
        write_github_output = Mock()
        with patch.dict(os.environ, {"GITHUB_OUTPUT": "github-output"}, clear=False):
            with patch("validate_vite_api_url.write_github_output", write_github_output):
                with patch("sys.argv", ["validate_vite_api_url.py", "--value", "https://localhost"]):
                    with redirect_stdout(StringIO()):
                        self.assertEqual(1, main())

        write_github_output.assert_not_called()


if __name__ == "__main__":
    unittest.main()

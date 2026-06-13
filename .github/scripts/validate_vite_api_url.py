from __future__ import annotations

import argparse
import ipaddress
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit


LOCAL_SUFFIXES = (".invalid", ".local", ".localhost", ".test", ".example")
RESERVED_HOSTS = {"example.com", "example.net", "example.org"}
DNS_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


def split_url(value: str):
    try:
        return urlsplit(value), None
    except ValueError as exc:
        return None, str(exc)


def parsed_hostname(parsed) -> tuple[str | None, str | None]:
    try:
        return parsed.hostname, None
    except ValueError as exc:
        return None, str(exc)


def parsed_port(parsed) -> tuple[int | None, str | None]:
    try:
        return parsed.port, None
    except ValueError as exc:
        return None, str(exc)


def is_ip_like_host(host: str) -> bool:
    if ":" in host:
        return True
    if re.fullmatch(r"[0-9.]+", host):
        return True
    labels = host.split(".")
    if 1 <= len(labels) <= 4 and all(re.fullmatch(r"(?:0x[0-9a-f]+|[0-9]+)", label) for label in labels):
        return True
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def is_valid_dns_host(host: str) -> bool:
    if host.endswith(".") or "." not in host:
        return False
    if len(host) > 253:
        return False
    if not any("a" <= char <= "z" for char in host):
        return False
    labels = host.split(".")
    return all(DNS_LABEL_RE.fullmatch(label) for label in labels)


def validation_errors(value: str) -> list[str]:
    errors: list[str] = []
    if value == "":
        errors.append("GitHub Actions variable VITE_API_URL is required")

    if value.strip() != value or any(char.isspace() for char in value):
        errors.append("VITE_API_URL must not contain leading, trailing, or embedded whitespace")
    if "\\" in value:
        errors.append("VITE_API_URL must not contain backslashes")

    parsed, split_error = split_url(value)
    if split_error is not None:
        errors.append(f"VITE_API_URL is malformed: {split_error}")
        return errors

    port, port_error = parsed_port(parsed)
    if port_error is not None:
        errors.append(f"VITE_API_URL has an invalid port: {port_error}")
    elif port == 0:
        errors.append("VITE_API_URL port must be between 1 and 65535")

    host, host_error = parsed_hostname(parsed)
    if host_error is not None:
        errors.append(f"VITE_API_URL has an invalid host: {host_error}")

    if parsed.scheme != "https":
        errors.append("VITE_API_URL must use the https scheme")
    if not parsed.netloc or not host:
        errors.append("VITE_API_URL must include a host")
    if parsed.username or parsed.password:
        errors.append("VITE_API_URL must not include credentials")
    if parsed.path or parsed.query or parsed.fragment or "?" in value or "#" in value:
        errors.append("VITE_API_URL must be an origin only, with no path, query, fragment, or trailing slash")

    if host:
        host_lower = host.lower()
        if is_ip_like_host(host_lower):
            errors.append("VITE_API_URL must use a public DNS host, not an IP address")
        elif not is_valid_dns_host(host_lower):
            errors.append("VITE_API_URL must use a valid public DNS host")
        comparable_host = host_lower.rstrip(".")
        if (
            comparable_host == "localhost"
            or comparable_host in RESERVED_HOSTS
            or any(comparable_host.endswith(f".{reserved}") for reserved in RESERVED_HOSTS)
            or comparable_host.endswith(LOCAL_SUFFIXES)
        ):
            errors.append("VITE_API_URL must be a production HTTPS origin, not a local or reserved test host")

        host_part = f"[{host_lower}]" if ":" in host_lower else host_lower
        canonical = f"https://{host_part}"
        if port is not None and port != 443:
            canonical += f":{port}"
        if value != canonical:
            errors.append(f"VITE_API_URL must be the canonical HTTPS origin: {canonical}")

    return errors


def write_github_output(origin: str) -> None:
    output_path = os.environ.get("GITHUB_OUTPUT")
    if not output_path:
        return
    with Path(output_path).open("a", encoding="utf-8") as output:
        output.write(f"origin={origin}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the production VITE_API_URL GitHub Actions variable.")
    parser.add_argument("--value", default=os.environ.get("VITE_API_URL", ""))
    args = parser.parse_args()

    errors = validation_errors(args.value)
    if errors:
        for error in errors:
            print(f"::error::{error}")
        return 1

    write_github_output(args.value)
    return 0


if __name__ == "__main__":
    sys.exit(main())

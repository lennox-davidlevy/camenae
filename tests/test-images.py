"""Resolve actual runner Compose stacks without building or starting services."""

import json
import os
from pathlib import Path
import re
import subprocess


root = Path(__file__).resolve().parent.parent
environment = {
    **os.environ,
    "CAMENAE_DATABASE_PASSWORD": "synthetic-test-only",
    "CAMENAE_OPENCODE_PASSWORD": "synthetic-test-only",
    "CAMENAE_AUTH_FILE": "/nonexistent/synthetic-test-only.json",
    "CAMENAE_INFERENCE_PREFIX": "172.30.87",
}


def resolve(files: list[str], project: str) -> dict:
    command = ["docker", "compose", "--env-file", "/dev/null", "-p", project]
    for file in files:
        command.extend(["-f", file])
    result = subprocess.run(
        [*command, "config", "--format", "json"],
        cwd=root,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


for suite in ("foundation", "opencode", "console"):
    runner = (root / f"scripts/smoke-{suite}.sh").read_text()
    dc = next(line for line in runner.splitlines() if line.startswith("dc()"))
    files = re.findall(r"-f ([\w/.-]+)", dc)
    first = resolve(files, "camenae-image-check-one")
    second = resolve(files, "camenae-image-check-two")
    for name, service in first["services"].items():
        if "build" not in service:
            assert service["image"] == "postgres:16.15-alpine"
            continue
        assert service["image"] == f"camenae-test-{name}:latest", (suite, name)
        assert service["image"] == second["services"][name]["image"]
        assert service["build"]["labels"]["app.camenae.test-image"] == "true"
        assert service["build"]["dockerfile"].startswith("docker/")
    for section in ("volumes", "networks"):
        for name, resource in first[section].items():
            assert resource["name"] != second[section][name]["name"]
    assert "sh scripts/cleanup-test-images.sh" in runner

deployment = resolve(["compose.yaml"], "camenae")
for service in deployment["services"].values():
    assert not service.get("image", "").startswith("camenae-test-")
    assert "app.camenae.test-image" not in service.get("build", {}).get("labels", {})

print("Test image tags are stable; project state and deployment images stay isolated.")

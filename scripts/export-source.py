#!/usr/bin/env python3
"""Export reviewed source inputs, never a working-directory snapshot."""
import gzip
import hashlib
import io
from pathlib import Path
import re
import sys
import tarfile

ROOT = Path(__file__).resolve().parent.parent
ROOT_FILES = (".dockerignore", ".gitignore", ".oxlintrc.json", "AGENTS.md",
              "README.md", "THIRD-PARTY-NOTICES.md", "bun.lock", "compose.yaml", "compose.opencode.yaml",
              "package.json", "tsconfig.json", "bunfig.toml")
TREES = ("docker", "docs", "scripts", "src", "tests", "tools/oxlint")
EXTENSIONS = {".ts", ".tsx", ".js", ".py", ".sh", ".css", ".html", ".md",
              ".json", ".yaml", ".conf", ".Dockerfile", ".ttf", ".png", ".txt"}
SUSPICIOUS = (
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(rb"(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{30,}"),
    re.compile(rb"\bAKIA[A-Z0-9]{16}\b"),
    re.compile(rb"/(?:home|Users)/[A-Za-z][A-Za-z0-9_.-]+/"),
)


def selected_files():
    files = [ROOT / name for name in ROOT_FILES]
    for tree in TREES:
        directory = ROOT / tree
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError(f"Missing or unsafe source tree: {tree}")
        for path in sorted(directory.rglob("*")):
            if path.is_symlink():
                raise ValueError(f"Symlink in source selection: {path.relative_to(ROOT)}")
            if path.is_dir():
                if path.name.startswith(".") or path.name in {"node_modules", "__pycache__", "uploads"}:
                    raise ValueError(f"Unexpected source directory: {path.relative_to(ROOT)}")
                continue
            # Design-editor thumbnails/backups are not runtime or reference assets.
            relative = path.relative_to(ROOT).as_posix()
            if relative == "docs/design/.thumbnail" or (relative.startswith("docs/design/") and path.suffix == ".bak"):
                continue
            if path.suffix not in EXTENSIONS and path.name != "LICENSE" and path != ROOT / "docker/opencode-runtime/bun.lock":
                raise ValueError(f"Unexpected source file: {path.relative_to(ROOT)}")
            if path.name in {"credentials.json", "login.txt", "session.json"}:
                raise ValueError(f"Private data filename: {path.relative_to(ROOT)}")
            files.append(path)
    return sorted(files)


def main():
    if len(sys.argv) != 2:
        raise ValueError("Usage: bun run export:source /new/external/directory")
    destination = Path(sys.argv[1]).resolve()
    if destination == ROOT or ROOT in destination.parents:
        raise ValueError("Export destination must be outside the checkout")
    sources = []
    inventory = []
    for path in selected_files():
        name = path.relative_to(ROOT).as_posix()
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Missing/unsafe source file: {name}")
        data = path.read_bytes()
        if path.suffix not in {".png", ".ttf"} and any(pattern.search(data) for pattern in SUSPICIOUS):
            raise ValueError(f"Potential secret/private path in {name}; inspect privately")
        sources.append((name, data))
        inventory.append(f"{hashlib.sha256(data).hexdigest()}\t{len(data)}\t{name}\n")
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    archive = destination / "camenae-source.tar.gz"
    with archive.open("wb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as bundle:
                for name, data in sources:
                    entry = tarfile.TarInfo("camenae/" + name)
                    entry.size = len(data)
                    entry.mode = 0o644
                    bundle.addfile(entry, io.BytesIO(data))
    (destination / "SOURCE-INVENTORY.tsv").write_text("sha256\tbytes\tpath\n" + "".join(inventory))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (destination / "SHA256SUMS").write_text(f"{digest}  {archive.name}\n")
    print(f"Exported {len(sources)} source files to {destination}")
    print(f"SHA-256: {digest}")
    print("Targeted secret/private-path scan passed; review the inventory before sharing.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        sys.exit(str(error))

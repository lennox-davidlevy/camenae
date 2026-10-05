#!/usr/bin/env python3
"""Check local inline Markdown links, including heading anchors, without network."""
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent


def anchors(path):
    result = set()
    counts = {}
    for heading in re.findall(r"^#{1,6}\s+(.+?)\s*#*\s*$", path.read_text(), re.MULTILINE):
        slug = re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-")
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        result.add(f"{slug}-{count}" if count else slug)
    return result


def main():
    files = list(ROOT.glob("*.md"))
    for tree in ("docs", "tools/oxlint", "src", "scripts", "tests", "docker"):
        files.extend((ROOT / tree).rglob("*.md"))
    failures = []
    checked = 0
    for path in sorted(files):
        for match in re.finditer(r"\[[^\]]*\]\(([^)]+)\)", path.read_text()):
            link = match.group(1).strip().strip("<>")
            parsed = urlsplit(link)
            if parsed.scheme or parsed.netloc:
                continue
            target = (path.parent / unquote(parsed.path)).resolve() if parsed.path else path
            checked += 1
            if ROOT not in target.parents or not target.exists():
                failures.append(f"{path.relative_to(ROOT)}: missing/outside source link {link}")
            elif parsed.fragment and target.suffix == ".md" and unquote(parsed.fragment) not in anchors(target):
                failures.append(f"{path.relative_to(ROOT)}: missing anchor {link}")
    if failures:
        sys.exit("\n".join(failures))
    print(f"Documentation links passed: {checked} local links in {len(files)} Markdown files")


if __name__ == "__main__":
    main()

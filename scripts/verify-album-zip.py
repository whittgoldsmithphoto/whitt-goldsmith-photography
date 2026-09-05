"""Read-only, bounded-memory verification of a downloaded WGP album ZIP.

Usage: python3 scripts/verify-album-zip.py DOWNLOAD.zip ORIGINAL_FOLDER
Never extracts the archive or modifies source photographs.
"""

import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path


def digest(stream):
    sha = hashlib.sha256()
    size = 0
    while chunk := stream.read(1024 * 1024):
        sha.update(chunk)
        size += len(chunk)
    return size, sha.hexdigest()


def verify(archive_path, source_directory):
    originals = {
        path.name: path
        for path in Path(source_directory).iterdir()
        if path.is_file() and path.suffix.lower() in (".jpg", ".jpeg", ".png")
    }
    if not originals:
        raise ValueError("Source directory contains no photographs")
    total = 0
    seen = set()
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        if len(entries) != len(originals):
            raise ValueError("Archive/source photograph count differs")
        for index, entry in enumerate(entries, 1):
            match = re.fullmatch(r"([0-9]{4})-([^/\\]+)", entry.filename)
            if not match or int(match[1]) != index or entry.is_dir():
                raise ValueError("Unexpected archive entry name/order")
            name = match[2]
            if name in seen or name not in originals:
                raise ValueError("Duplicate or unknown photograph")
            if entry.flag_bits & 1 or entry.compress_type != zipfile.ZIP_STORED:
                raise ValueError("Unexpected encrypted/compressed archive entry")
            source = originals[name]
            if entry.file_size != source.stat().st_size:
                raise ValueError("Original size mismatch")
            with source.open("rb") as original, archive.open(entry) as downloaded:
                source_identity = digest(original)
                if digest(downloaded) != source_identity:
                    raise ValueError("Original SHA256 mismatch")
            total += source_identity[0]
            seen.add(name)
    return {"verified": True, "photos": len(seen), "original_bytes": total}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    print(json.dumps(verify(sys.argv[1], sys.argv[2])))

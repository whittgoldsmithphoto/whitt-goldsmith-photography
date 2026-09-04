# Archive ingest safety boundary

`validateArchiveEntries` is the metadata gate for a future folder/ZIP ingest
pipeline. It accepts only regular JPEG/PNG files and rejects traversal,
ambiguous paths, Unix symlinks, directories, encrypted ZIP entries, invalid
sizes, excessive compression ratios, and archive-wide compressed-byte budgets.
It delegates path and per-file/total uncompressed limits to the canonical
folder manifest validator.

This module deliberately does **not** parse ZIP bytes, extract files, follow
links, or upload anything. A production extractor must read the central
directory safely, call this gate before extraction, stream each entry into a
bounded sink, enforce the same limits while streaming (to catch forged ZIP
metadata), verify image signatures and checksums, and only then create the
durable catalog photo and derivative job. ZIP encryption/password handling is
not supported; encrypted entries must fail closed.

The current defaults are 1,000 files, depth 8, 20 MiB per image, 1 GiB total
uncompressed bytes, 1 GiB compressed archive bytes, and a 100:1 maximum
compression ratio. Deployers may tighten these values, never loosen them.

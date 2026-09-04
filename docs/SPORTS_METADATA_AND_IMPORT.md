# Sports metadata and local import preparation

## Implemented scope

The owner can save team, sport, opponent, date, venue, jersey number, subject and private photographer notes for an individual catalog photo. Public search uses only explicitly owner-approved metadata on published public galleries without a password. Photos must be ready, visible and unarchived, with both preview and thumbnail records. Original object keys, private notes and revision history are never in public search responses. Delivery still goes through the catalog's access-checked watermarked derivative endpoint.

Every metadata edit has an optimistic revision and an atomically saved historical snapshot. Concurrent stale edits fail rather than overwrite. Restoring a previous version creates a new **unapproved** draft; it never silently restores public approval. Editing public fields in the owner UI clears approval. The owner can review and approve them again.

After a successful metadata save, the editor can reuse the last saved event's team, sport, opponent, venue and date in another photo's **unsaved, unapproved draft**. The owner must review and save. The target photo's jersey, subject, private notes, ID and revision are preserved. Only those five event fields are remembered in optional browser session storage for this tab; no private notes, person metadata or approval state is cached. The owner can forget the saved event. This convenience is not a server bulk edit or automatic publication.

Deploy migration `0009_sports_metadata.sql` before using `/api/sports`. Missing storage/schema fails with a retryable unavailable state, not fabricated results. Search currently uses exact word tokens across approved fields, not fuzzy matching or facial recognition. Search is capped at 25 results per page and 1,025 total results; historical revisions expose the latest 50 to the owner. It is not a complete library-scale search system or AI recognition product.

## Lightroom export preparation (not automatic publishing)

1. Export finished photographs from Lightroom into a local folder as JPEG or PNG, at or below 20 MiB each. Keep RAW originals in your existing archive; this uploader does not support RAW/TIFF yet.
2. Wait until export completes. Run a read-only inventory:

```sh
node scripts/photo-import-manifest.mjs --source "/path/to/export-folder"
```

3. Optionally save a private JSON manifest to a **new** filename:

```sh
node scripts/photo-import-manifest.mjs --source "/path/to/export-folder" --output "/path/to/new-manifest.json"
```

4. Review eligible files, duplicate checksums, unsupported files and rejected/unstable exports. Upload eligible images through the authenticated Organizer. A valid header is only preliminary validation; the server still decodes/processes and verifies every upload.

The scanner reads subfolders, does not follow symlinks, validates extension/signature/size, records SHA-256, detects identical bytes, and detects files changing during reading. It does not alter originals, read credentials, upload, watch continuously, publish galleries or import the manifest into the server. Output creation is opt-in and refuses to overwrite an existing file. Filenames may themselves be private; keep the JSON private. This is preparation for a later watched-folder publisher, not a claim that automatic Lightroom publishing is finished.

## Validation

```sh
node --experimental-strip-types --test src/lib/sports/sports.test.ts
node --test scripts/photo-import-manifest.test.mjs
node scripts/sports-browser-check.mjs
```

The browser acceptance harness uses real local HTTP, BetterAuth accounts, shared PGlite and the mounted owner/search UI with synthetic display media. It does not certify Cloudflare/Neon/R2 deployment or use production accounts/photos.

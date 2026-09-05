import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("downloaded album verifier accepts exact originals and rejects substituted bytes", () => {
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import importlib.util, pathlib, tempfile, zipfile
spec = importlib.util.spec_from_file_location("verify_album", "scripts/verify-album-zip.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix="wgp-zip-verifier-test-") as tmp:
    root = pathlib.Path(tmp)
    sources = root / "sources"
    sources.mkdir()
    (sources / "photo.jpg").write_bytes(b"original")
    good = root / "good.zip"
    with zipfile.ZipFile(good, "w") as archive:
        archive.writestr("0001-photo.jpg", b"original")
    assert module.verify(good, sources) == {"verified": True, "photos": 1, "original_bytes": 8}
    bad = root / "bad.zip"
    with zipfile.ZipFile(bad, "w") as archive:
        archive.writestr("0001-photo.jpg", b"modified")
    try:
        module.verify(bad, sources)
    except ValueError as error:
        assert "SHA256" in str(error)
    else:
        raise AssertionError("Modified original was accepted")
`,
    ],
    { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
  assert.equal(result.status, 0, result.stderr);
});

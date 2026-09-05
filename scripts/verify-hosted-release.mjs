/** Verify code provenance and referenced application assets after deployment. */
export async function verifyHostedRelease(origin, revision, request = fetch) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Invalid release revision");
  const response = await request(origin, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok || response.headers.get("x-wgp-revision") !== revision)
    throw new Error("Hosted release revision does not match; deployment is not verified");
  const html = await response.text();
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/assets\/[^"<>]+\.(?:js|css))"/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  if (!assets.length) throw new Error("Hosted page has no verifiable application assets");
  await Promise.all(
    assets.map(async (path) => {
      const asset = await request(new URL(path, origin), {
        method: "HEAD",
        signal: AbortSignal.timeout(15000),
      });
      if (!asset.ok || /text\/html/.test(asset.headers.get("content-type") || ""))
        throw new Error("Hosted application asset unavailable");
    }),
  );
  return assets.length;
}

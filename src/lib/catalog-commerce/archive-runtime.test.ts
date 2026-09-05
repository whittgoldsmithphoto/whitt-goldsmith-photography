import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveDeliveryEnabled } from "./archive-runtime.ts";

test("album ZIP requires both its own switch and accepted customer delivery", () => {
  const values: Record<string, string> = {
    CATALOG_ENV: "staging",
    CATALOG_ALBUM_ZIP_ENABLED: "true",
  };
  const setting = (name: string) => values[name] || "";
  assert.equal(archiveDeliveryEnabled(setting), false);
  values.CATALOG_CUSTOMER_DOWNLOADS_ENABLED = "true";
  values.CATALOG_STRIPE_SANDBOX_ACCEPTED = "true";
  assert.equal(archiveDeliveryEnabled(setting), true);
  values.CATALOG_ALBUM_ZIP_ENABLED = "false";
  assert.equal(archiveDeliveryEnabled(setting), false);
  values.CATALOG_ENV = "production";
  values.CATALOG_ALBUM_ZIP_ENABLED = "true";
  assert.equal(archiveDeliveryEnabled(setting), false);
  values.CATALOG_LIVE_DOWNLOADS_ENABLED = "true";
  values.CATALOG_LIVE_RELEASE_ACCEPTED = "true";
  values.CATALOG_LIVE_DELIVERY_ACCEPTED = "true";
  assert.equal(archiveDeliveryEnabled(setting), true);
});

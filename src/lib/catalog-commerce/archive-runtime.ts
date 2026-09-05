import { customerDownloadsEnabled } from "./customer-download.ts";

export function archiveDeliveryEnabled(setting: (name: string) => string) {
  return setting("CATALOG_ALBUM_ZIP_ENABLED") === "true" && customerDownloadsEnabled(setting);
}

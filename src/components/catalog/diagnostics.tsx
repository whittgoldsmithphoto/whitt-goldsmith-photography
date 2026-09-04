import { useCatalog } from "@/lib/catalog/client";
import { Button } from "@/components/ui/button";

export function CatalogDiagnostics() {
  const state = useCatalog<{
    environment: string;
    storageMode: string;
    database: string;
    r2Configured: boolean;
    imagesConfigured: boolean;
    watermarkConfigured: boolean;
    missingMigrations: string[];
    checkedAt: string;
  }>("op=diagnostics");
  if (!state.data)
    return (
      <div role="status" className="mt-3">
        {state.loading ? "Checking server configuration…" : state.error?.message}
        {state.error && (
          <Button variant="outline" onClick={state.reload}>
            Retry diagnostics
          </Button>
        )}
      </div>
    );
  const data = state.data;
  return (
    <div className="mt-3 space-y-2">
      <p>
        Environment: {data.environment}. Database: {data.database}.
      </p>
      <p>
        R2 ({data.storageMode}): {data.r2Configured ? "configured" : "missing"}. Images binding:{" "}
        {data.imagesConfigured ? "configured" : "missing"}. Watermark key:{" "}
        {data.watermarkConfigured ? "configured" : "missing"}.
      </p>
      <p>
        Catalog migrations:{" "}
        {data.missingMigrations.length ? `missing ${data.missingMigrations.join(", ")}` : "applied"}
        .
      </p>
      <p>
        Configuration check only—not proof of working storage, bucket privacy, valid credentials or
        correct image processing. Checked {new Date(data.checkedAt).toLocaleString()}.
      </p>
      <Button variant="outline" onClick={state.reload}>
        Refresh diagnostics
      </Button>
    </div>
  );
}

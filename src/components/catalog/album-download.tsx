import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth/api-fetch";
import { Button } from "@/components/ui/button";

type Job = { jobId: string; status: string };
export function AlbumDownload({ orderId, eligible }: { orderId: string; eligible: boolean }) {
  const [job, setJob] = useState<Job>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  async function post(body: unknown, signal?: AbortSignal): Promise<Job> {
    const response = await apiFetch("/api/commerce-archive", {
      method: "POST",
      signal,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Album download unavailable");
    if (typeof data.jobId !== "string" || typeof data.status !== "string")
      throw new Error("Invalid album response");
    return data;
  }
  useEffect(() => {
    if (!job || !["queued", "processing", "retry"].includes(job.status) || !eligible) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void post({ op: "status", jobId: job.jobId }, abort.signal)
        .then(setJob)
        .catch((reason) => {
          if (!abort.signal.aborted)
            setError(reason instanceof Error ? reason.message : "Status unavailable");
        });
    }, 15000);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [job, eligible]);
  async function prepare() {
    setBusy(true);
    setError("");
    setSubmitted(false);
    try {
      setJob(await post({ op: "request", orderId }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Album unavailable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 border-y py-4">
      <p className="font-medium">Download the album as a ZIP</p>
      <p className="text-sm text-muted-foreground">
        Includes only the photographs in this purchase. Each ZIP download uses one remaining
        download for every included photo. Your usage rights do not expire.
      </p>
      {!eligible ? (
        <p className="text-sm">
          The album download window or one of its photo allowances has ended. Previously downloaded
          files remain yours to use under your license.
        </p>
      ) : job?.status === "completed" ? (
        <form
          action="/api/commerce-archive"
          method="post"
          target="_self"
          onSubmit={() => setSubmitted(true)}
        >
          <input type="hidden" name="op" value="deliver" />
          <input type="hidden" name="jobId" value={job.jobId} />
          <Button type="submit" variant="outline" disabled={submitted}>
            Download album ZIP
          </Button>
          {submitted && (
            <p role="status" className="mt-2 text-sm">
              Download requested. Check your browser downloads. Refresh order status before
              requesting another copy.
            </p>
          )}
        </form>
      ) : (
        <>
          <Button
            variant="outline"
            disabled={
              busy ||
              Boolean(job && ["queued", "processing", "retry"].includes(job.status) && !error)
            }
            onClick={() => void prepare()}
          >
            {busy
              ? "Requesting album…"
              : job && !error
                ? "Album preparation requested"
                : "Prepare album ZIP"}
          </Button>
          {job && (
            <p role="status" className="text-sm">
              {job.status === "failed" || job.status === "cancelled"
                ? "Album preparation could not finish. Contact the photographer; individual photo downloads may still be available."
                : "Your album is being prepared on the server. This can take several minutes. You may return to this purchase later."}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

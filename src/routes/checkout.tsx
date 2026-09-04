import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/checkout")({ component: CommerceUnavailable });
function CommerceUnavailable() {
  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="font-display text-4xl">Checkout is not available yet</h1>
      <p className="my-6 text-muted-foreground">
        You can browse galleries and save proof selections. Payments and downloads will open after
        pricing and fulfillment have been verified. No order has been placed and nothing has been
        charged.
      </p>
      <Button asChild variant="outline">
        <Link to="/galleries">Browse galleries</Link>
      </Button>
    </div>
  );
}

import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/checkout/thanks")({ component: Thanks });

function Thanks() {
  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Order</p>
      <h1 className="font-display mt-2 text-4xl">Thank you</h1>
      <p className="mt-3 text-muted-foreground">
        The studio has the order — name, email, and shipping. A receipt comes from Stripe.
      </p>
      <Button asChild className="mt-8">
        <Link to="/galleries">Back to galleries</Link>
      </Button>
    </div>
  );
}

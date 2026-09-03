import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const searchSchema = z.object({
  setup: z.coerce.string().optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: searchSchema,
  component: Login,
});

function Login() {
  const { setup } = Route.useSearch();
  const firstRun = setup === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (firstRun) {
        const res = await authClient.signUp.email({ email, password, name: "Whitt Goldsmith" });
        if (res.error) throw new Error(res.error.message || "Could not create the account");
      } else {
        const res = await authClient.signIn.email({ email, password });
        if (res.error) throw new Error(res.error.message || "Could not sign in");
      }
      window.location.assign("/organize");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70svh] max-w-sm flex-col justify-center px-4 py-16">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Studio</p>
      <h1 className="font-display mt-2 text-4xl tracking-tight">{firstRun ? "Set up" : "Owner"}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {firstRun
          ? "Create your account. Studio access must then be granted to its account ID in OWNER_USER_IDS."
          : "Sign in with an account that has been granted studio access."}
      </p>
      {authEnabled ? (
        <div className="mt-8 grid gap-3">
          {GROK_PROVIDERS.map((p) => (
            <Button
              key={p.providerId}
              type="button"
              variant="outline"
              onClick={() => signIn(p.providerId, { callbackURL: "/organize" })}
            >
              Continue with {p.label}
            </Button>
          ))}
          <p className="pt-4 text-center text-xs uppercase tracking-[0.16em] text-muted-foreground">or email</p>
          <form className="grid gap-3" onSubmit={(e) => void onEmail(e)}>
            <div className="grid gap-1.5">
              <Label htmlFor="em">Email</Label>
              <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw">Password</Label>
              <Input
                id="pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Working…" : firstRun ? "Create owner account" : "Enter studio"}
            </Button>
          </form>
        </div>
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">Sign-in is disabled.</p>
      )}
      <Link to="/" className="mt-10 text-sm text-muted-foreground hover:text-foreground">
        Back to the studio
      </Link>
    </div>
  );
}

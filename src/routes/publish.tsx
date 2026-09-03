import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireOwner } from "@/components/require-owner";

export const Route = createFileRoute("/publish")({
  component: () => (
    <RequireOwner>
      <PublishPage />
    </RequireOwner>
  ),
});

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-card px-5 py-5 shadow-[var(--shadow-border)]">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Step {n}</p>
      <h2 className="font-display mt-1 text-2xl">{title}</h2>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="block break-all rounded-md bg-secondary px-3 py-2 text-xs text-foreground">{children}</code>
  );
}

function PublishPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Studio</p>
      <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">Publish</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Move the live site onto Cloudflare — same account as R2. Do these in order. When a step asks
        for a value, come back here or paste it in chat and I will finish that piece.
      </p>

      <div className="mt-8 grid gap-4">
        <Step n="1" title="GitHub repo">
          <p>
            Create an empty repository named{" "}
            <span className="text-foreground">whitt-goldsmith-photography</span>. Do not add a README.
          </p>
          <a
            className="text-foreground underline underline-offset-2"
            href="https://github.com/new"
            target="_blank"
            rel="noreferrer"
          >
            github.com/new
          </a>
          <p>Then tell me the repo URL (you/whitt-goldsmith-photography). I will push this studio into it.</p>
        </Step>

        <Step n="2" title="Neon database">
          <p>
            Cloudflare Workers cannot keep owner logins in R2. Create a free Neon Postgres and copy the
            pooled connection string (starts with postgresql://).
          </p>
          <a
            className="text-foreground underline underline-offset-2"
            href="https://console.neon.tech"
            target="_blank"
            rel="noreferrer"
          >
            console.neon.tech
          </a>
        </Step>

        <Step n="3" title="Hyperdrive">
          <p>
            In Cloudflare: Storage & databases → Hyperdrive → Create. Paste the Neon URL. Copy the
            Hyperdrive connection string — that is DATABASE_URL on the Worker.
          </p>
          <a
            className="text-foreground underline underline-offset-2"
            href="https://dash.cloudflare.com/?to=/:account/workers/hyperdrive"
            target="_blank"
            rel="noreferrer"
          >
            Open Hyperdrive
          </a>
        </Step>

        <Step n="4" title="Connect Git on Cloudflare">
          <p>
            Workers & Pages → Create → Workers → Connect to Git. Select the repo from step 1.
          </p>
          <p>Build command:</p>
          <Code>npm run build:cloudflare</Code>
          <p>Deploy command:</p>
          <Code>npx wrangler deploy</Code>
        </Step>

        <Step n="5" title="Secrets on the Worker">
          <p>Worker → Settings → Variables and Secrets. Add:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="text-foreground">BETTER_AUTH_URL</span> — your future site URL, e.g. https://whittgoldsmith.com
            </li>
            <li>
              <span className="text-foreground">BETTER_AUTH_SECRET</span> — a long random string
            </li>
            <li>
              <span className="text-foreground">DATABASE_URL</span> — Hyperdrive string from step 3
            </li>
          </ul>
          <p>
            R2 and Stripe can stay in Settings after you sign in on the live site, or you can add those
            secrets here too.
          </p>
        </Step>

        <Step n="6" title="Domain">
          <p>
            Worker → Settings → Domains & Routes → Add your studio domain. Stripe webhook becomes
          </p>
          <Code>https://your-domain/api/webhooks/stripe</Code>
          <p>
            First owner login is <span className="text-foreground">/login?setup=1</span>. Bookmark{" "}
            <span className="text-foreground">/login</span> after that.
          </p>
        </Step>
      </div>
    </div>
  );
}

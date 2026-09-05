import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { StudioShell } from "@/components/studio-shell";
import appCss from "../styles.css?url";
import { documentSecurityHeaders } from "../lib/security-headers";

const APP_NAME = "Whitt Goldsmith Photography";

export const Route = createRootRoute({
  headers: () =>
    import.meta.env.DEV
      ? {
          ...documentSecurityHeaders,
          "Content-Security-Policy": "base-uri 'self'; object-src 'none'",
        }
      : documentSecurityHeaders,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "Whitt Goldsmith Photography — sports and events in Greenville, South Carolina. Prints and files from the galleries.",
      },
      { name: "theme-color", content: "#f3ead6" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <StudioShell>
            <Outlet />
          </StudioShell>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});

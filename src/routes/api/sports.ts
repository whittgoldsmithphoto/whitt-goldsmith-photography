import { createFileRoute } from "@tanstack/react-router";
import { sportsRequest } from "@/lib/sports/http.server";

export const Route = createFileRoute("/api/sports")({
  server: {
    handlers: {
      GET: ({ request }) => sportsRequest(request),
      POST: ({ request }) => sportsRequest(request),
    },
  },
});

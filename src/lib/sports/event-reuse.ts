import { z } from "zod";
import type { SportsMetadata } from "./repository.ts";

export const EVENT_REUSE_KEY = "wgp:sports-event-draft:v1";
const field = z.string().trim().max(160);
const schema = z
  .object({
    team: field,
    sport: field,
    opponent: field,
    venue: field,
    eventDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const date = new Date(`${value}T00:00:00Z`);
        return (
          !value.startsWith("0000-") &&
          !Number.isNaN(date.valueOf()) &&
          date.toISOString().slice(0, 10) === value
        );
      })
      .nullable(),
  })
  .strict();
export type EventDetails = z.infer<typeof schema>;
type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function eventDetails(metadata: SportsMetadata): EventDetails {
  return schema.parse({
    team: metadata.team,
    sport: metadata.sport,
    opponent: metadata.opponent,
    venue: metadata.venue,
    eventDate: metadata.eventDate,
  });
}
export function readRememberedEvent(storage: TabStorage): EventDetails | null {
  try {
    const raw = storage.getItem(EVENT_REUSE_KEY);
    return raw ? schema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
/** Caller provides sessionStorage. Only these five event fields can leave the current form. */
export function rememberSavedEvent(storage: TabStorage, metadata: SportsMetadata): boolean {
  try {
    storage.setItem(EVENT_REUSE_KEY, JSON.stringify(eventDetails(metadata)));
    return true;
  } catch {
    return false;
  }
}
export function forgetRememberedEvent(storage: TabStorage): boolean {
  try {
    storage.removeItem(EVENT_REUSE_KEY);
    return true;
  } catch {
    return false;
  }
}
export function applyRememberedEvent(
  current: SportsMetadata,
  remembered: EventDetails,
): SportsMetadata {
  return { ...current, ...schema.parse(remembered), approved: false };
}

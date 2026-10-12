import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[ ()-]/g, ""))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/));
export const notificationSettingsSchema = z
  .object({
    whatsapp_enabled: z.boolean(),
    email_enabled: z.boolean(),
    fallback_enabled: z.boolean(),
    fallback_after_seconds: z.number().int().min(30).max(86400),
    consent: z.literal(true),
    revision: z.uuid(),
  })
  .strict();
export type Channel = "whatsapp" | "email";
export type DeliveryStatus =
  | "queued"
  | "submitting"
  | "accepted"
  | "sent"
  | "delivered"
  | "read"
  | "retry_scheduled"
  | "failed"
  | "undelivered"
  | "unknown"
  | "suppressed"
  | "blocked";
export interface NotificationSettings {
  whatsapp_destination: string | null;
  whatsapp_verified_at: string | null;
  whatsapp_window_until: string | null;
  whatsapp_enabled: boolean;
  email_destination: string | null;
  email_enabled: boolean;
  fallback_enabled: boolean;
  fallback_after_seconds: number;
  revision: string;
}
export interface DeliveryJob {
  id: string;
  user_id: string;
  reminder_id: string | null;
  occurrence: number | null;
  logical_key: string;
  channel: Channel;
  provider: "twilio" | "resend";
  kind: "reminder" | "test";
  destination: string | null;
  preference_revision: string;
  status: DeliveryStatus;
  fallback_of: string | null;
  fallback_deadline_at: string | null;
  next_attempt_at: string | null;
  attempt_count: number;
  reconcile_count: number;
  provider_message_id: string | null;
  error_category: string | null;
  attention: boolean;
  lease_token: string | null;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  delivered_at: string | null;
}

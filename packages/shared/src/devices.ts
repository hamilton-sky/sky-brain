// Request bodies of device login (spec.md Routes). Every body is strict: an unknown field is
// refused, so no caller can send a user id, a device id or an author.
import { z } from "zod";

export const DEVICE_CODE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:device_code";

/** `POST /api/device/code`. */
export const DeviceCodeRequestSchema = z.strictObject({
  client_name: z.string().min(1).max(64),
});

/** `POST /api/device/token`. The grant type is checked apart, for its own RFC 6749 error. */
export const DeviceTokenRequestSchema = z.strictObject({
  grant_type: z.string().max(128),
  device_code: z.string().min(1).max(256),
});

/** `POST /api/v1/devices/approve`. The user code is matched ignoring case and the dash. */
export const DeviceApproveRequestSchema = z.strictObject({
  user_code: z.string().min(1).max(32),
  name: z.string().trim().min(1).max(100),
});

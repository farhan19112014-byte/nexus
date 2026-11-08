/** The Live Vision part of a chat request (kept apart from shared/vision.ts so ordinary chat code stays small). */
import { z } from 'zod';

/** a base64 640×480 frame is far below this; the server checks the real image separately */
const MAX_FRAME_CHARS = 800_064;
/** What a chat turn carries while Live Vision is on: the newest frame (optional) and the recent observations as text. */
export const VisionChatContextSchema = z.object({
  frame: z.string().max(MAX_FRAME_CHARS).optional(),
  notes: z.string().max(3000).default(''),
  /** seconds since the frame / the newest observation was captured */
  ageS: z.number().min(0).max(86400).nullable().default(null),
}).strict();
export type VisionChatContext = z.infer<typeof VisionChatContextSchema>;

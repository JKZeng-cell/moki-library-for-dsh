import { z } from "zod";

export const ASSISTANT_TASK_SPACE_TAG = "moki-task-space";
export const ASSISTANT_TASK_SPACE_SOURCE_TAG_PREFIX = "moki-task-space-source:";
export const ASSISTANT_TASK_SPACE_DEDICATED_SESSION_TAG_PREFIX = "moki-task-space-dedicated-session:";
export const ASSISTANT_TASK_FOLDER_SESSION_TAG_PREFIX = "moki-task-folder-session:";

export const AssistantTaskSpaceSourceSchema = z.enum(["created", "library", "local"]);

export const AssistantTaskSpaceSchema = z.object({
  id: z.string().trim().min(1).max(160),
  resourceId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(240),
  path: z.string().trim().min(1).max(4_096),
  source: AssistantTaskSpaceSourceSchema,
  permission: z.literal("full"),
  available: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const AssistantTaskSpaceCreateSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("new"), name: z.string().trim().min(1).max(80) }).strict(),
  z.object({ mode: z.literal("library"), resourceId: z.string().trim().min(1).max(160) }).strict(),
  z.object({ mode: z.literal("local"), path: z.string().trim().min(1).max(4_096), name: z.string().trim().min(1).max(80).optional() }).strict(),
]);

export const AssistantTaskSpaceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict();

export const AssistantSessionTaskSpaceSchema = z.object({
  taskSpaceId: z.string().trim().min(1).max(160).nullable(),
}).strict();

export const AssistantTaskSpaceStateSchema = z.object({
  assignments: z.record(z.string().min(1).max(160), z.string().min(1).max(160))
    .refine((value) => Object.keys(value).length <= 5_000, "任务空间会话绑定数量过多"),
}).strict();

export type AssistantTaskSpace = z.infer<typeof AssistantTaskSpaceSchema>;
export type AssistantTaskSpaceSource = z.infer<typeof AssistantTaskSpaceSourceSchema>;
export type AssistantTaskSpaceCreate = z.infer<typeof AssistantTaskSpaceCreateSchema>;
export type AssistantTaskSpaceUpdate = z.infer<typeof AssistantTaskSpaceUpdateSchema>;
export type AssistantSessionTaskSpace = z.infer<typeof AssistantSessionTaskSpaceSchema>;
export type AssistantTaskSpaceState = z.infer<typeof AssistantTaskSpaceStateSchema>;

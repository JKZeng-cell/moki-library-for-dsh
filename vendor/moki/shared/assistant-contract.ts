export const ASSISTANT_MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
export type AssistantImageAttachment = { id: string; name: string; mediaType: string; size: number; localPath?: string };

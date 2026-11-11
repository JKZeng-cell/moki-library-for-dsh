export const ASSISTANT_DOWNLOAD_DIRECTORY_TAG = "moki-system-directory:downloads";
export const ASSISTANT_TASK_DIRECTORY_TAG = "moki-system-directory:tasks";

export type AssistantManagedDirectory = {
  id: "downloads" | "tasks";
  name: string;
  path: string;
  tag: string;
};

import { z } from 'zod';

export const WorkspaceEditorOperationSchema = z.enum(['activate', 'edit', 'read_text', 'replace_text', 'replace_range', 'patch_text', 'undo', 'redo', 'discard', 'save', 'save_as']);
export const WorkspaceEditorStateSchema = z.object({
  editorId: z.string().uuid(),
  id: z.string().min(1),
  name: z.string().max(240),
  active: z.boolean().optional(),
  activeTabId: z.string().optional(),
  tabs: z.array(z.object({id:z.string(),title:z.string(),kind:z.enum(['file','folder','browser','whiteboard']),resourceId:z.string().optional()})).optional(),
  mode: z.enum(['preview', 'text', 'office', 'workspace']),
  sessionId: z.string().optional(),
  dirty: z.boolean(),
  reviewCapable: z.boolean().optional(),
  pendingReviews: z.number().int().nonnegative().optional(),
  revision: z.number().int().nonnegative(),
  operations: z.array(WorkspaceEditorOperationSchema),
});
export const WorkspaceEditorActionSchema = z.object({
  editorId: z.string().uuid(),
  id: z.string().min(1),
  operation: WorkspaceEditorOperationSchema,
  tabId: z.string().optional(),
  content: z.string().max(900_000).optional(),
  range: z.object({start:z.number().int().nonnegative(),end:z.number().int().nonnegative(),expectedText:z.string().max(900_000)}).optional(),
  patches: z.array(z.object({before:z.string().min(1).max(900_000),after:z.string().max(900_000),expectedCount:z.number().int().min(1).max(1000).optional()})).min(1).max(100).optional(),
  destination: z.string().min(1).max(4096).optional(),
  revision: z.number().int().nonnegative().optional(),
}).superRefine((value, ctx) => {
  if (value.operation === 'activate' && !value.tabId) ctx.addIssue({code:'custom',message:'切换标签需要 tabId'});
  if (value.operation === 'replace_text' && value.content === undefined) ctx.addIssue({ code: 'custom', message: '修改文本草稿需要完整 content' });
  if (value.operation === 'replace_range' && (!value.range || value.content===undefined || value.range.end<value.range.start)) ctx.addIssue({code:'custom',message:'选区替换需要 content 和有效 range（start/end/expectedText）'});
  if (value.operation !== 'replace_range' && value.range) ctx.addIssue({code:'custom',message:'仅选区替换支持 range'});
  if (value.operation === 'patch_text' && !value.patches) ctx.addIssue({code:'custom',message:'局部修改需要 patches'});
  if (value.operation !== 'patch_text' && value.patches) ctx.addIssue({code:'custom',message:'仅局部修改支持 patches'});
  if (!['replace_text','replace_range'].includes(value.operation) && value.content !== undefined) ctx.addIssue({ code: 'custom', message: '此操作不接受 content' });
  if (value.operation !== 'save_as' && value.destination !== undefined) ctx.addIssue({ code: 'custom', message: '仅另存为支持 destination' });
});
export const WorkspaceEditorResultSchema = z.object({
  status: z.enum(['completed', 'cancelled', 'failed']),
  message: z.string().max(1000),
  sessionId: z.string().optional(),
  path: z.string().max(4096).optional(),
  content: z.string().max(5_000_000).optional(),
  review: z.object({id:z.string(),pending:z.number().int().nonnegative()}).optional(),
});
export type WorkspaceEditorState = z.infer<typeof WorkspaceEditorStateSchema>;
export type WorkspaceEditorAction = z.infer<typeof WorkspaceEditorActionSchema>;
export type WorkspaceEditorResult = z.infer<typeof WorkspaceEditorResultSchema>;
export type WorkspaceReviewControl = {editorId:string;id:string;operation:'review_control';phase:'prepare'|'refresh'};
export type WorkspaceEditorCommand = (WorkspaceEditorAction | WorkspaceReviewControl) & { requestId: string; expiresAt: number };

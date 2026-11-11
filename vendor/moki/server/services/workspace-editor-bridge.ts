import { randomUUID } from 'node:crypto';
import type { WorkspaceEditorAction, WorkspaceEditorCommand, WorkspaceEditorResult, WorkspaceEditorState } from '../../shared/workspace-editor-contract.js';

/** The mounted preview owns its draft. Commands must be acknowledged by that exact instance. */
export class WorkspaceEditorBridge {
  private editors = new Map<string, { state: WorkspaceEditorState; seen: number }>();
  private closedEditors = new Set<string>();
  private pending = new Map<string, { command: WorkspaceEditorCommand; claimed: boolean; resolve: (result: WorkspaceEditorResult) => void; timer: ReturnType<typeof setTimeout> }>();
  private commandWaiters = new Map<string, Set<(command: WorkspaceEditorCommand | undefined) => void>>();
  constructor(private readonly now = Date.now, private readonly timeoutMs = 120_000) {}
  register(state: WorkspaceEditorState) {
    if (this.closedEditors.has(state.editorId)) throw new Error('编辑器已关闭');
    const previous = this.editors.get(state.editorId);
    if (previous && previous.state.id !== state.id) throw new Error('编辑器绑定文件已变化');
    if (previous && previous.state.revision > state.revision) return;
    this.editors.set(state.editorId, { state, seen: this.now() });
  }
  list() { return [...this.editors.values()].filter(entry => this.now() - entry.seen < 10_000).map(entry => entry.state); }
  require(input: Pick<WorkspaceEditorAction, 'id' | 'editorId'>) {
    const state = this.list().find(entry => entry.editorId === input.editorId && entry.id === input.id);
    if (!state) throw new Error('目标预览已关闭或切换，请重新读取侧边工作区状态');
    return state;
  }
  request(input: WorkspaceEditorAction): Promise<WorkspaceEditorResult> {
    const state = this.require(input);
    if (!state.operations.includes(input.operation)) throw new Error('当前文件或编辑状态不支持此操作');
    if (input.revision !== undefined && input.revision !== state.revision) throw new Error('草稿已变化，请重新生成操作预览');
    if ([...this.pending.values()].some(entry => entry.command.editorId === input.editorId)) throw new Error('该编辑器已有操作正在进行');
    const command = { ...input, requestId: randomUUID(), expiresAt: this.now() + this.timeoutMs };
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(command.requestId);
        resolve({ status: 'failed', message: '编辑器未及时返回结果，请查看文件状态后再继续；不要假定保存成功' });
      }, this.timeoutMs);
      this.pending.set(command.requestId, { command, claimed: false, resolve, timer });
      this.wakeCommandWaiter(command.editorId);
    });
  }
  take(editorId: string): WorkspaceEditorCommand | undefined {
    const pending = [...this.pending.values()].find(entry => entry.command.editorId === editorId && !entry.claimed);
    if (!pending || pending.command.expiresAt <= this.now()) return undefined;
    pending.claimed = true;
    return pending.command;
  }
  waitForCommand(editorId: string, waitMs = 0): Promise<WorkspaceEditorCommand | undefined> {
    const command = this.take(editorId);
    if (command || waitMs <= 0) return Promise.resolve(command);
    return new Promise(resolve => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (next: WorkspaceEditorCommand | undefined) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        const waiters = this.commandWaiters.get(editorId);
        waiters?.delete(finish);
        if (!waiters?.size) this.commandWaiters.delete(editorId);
        resolve(next);
      };
      const waiters = this.commandWaiters.get(editorId) ?? new Set();
      waiters.add(finish);
      this.commandWaiters.set(editorId, waiters);
      timer = setTimeout(() => finish(undefined), waitMs);
    });
  }
  private wakeCommandWaiter(editorId: string) {
    const waiter = this.commandWaiters.get(editorId)?.values().next().value;
    if (waiter) waiter(this.take(editorId));
  }
  complete(editorId: string, requestId: string, result: WorkspaceEditorResult, state?: WorkspaceEditorState) {
    const pending = this.pending.get(requestId);
    if (!pending || !pending.claimed || pending.command.editorId !== editorId) return false;
    if (state) {
      if (state.editorId !== editorId || state.id !== pending.command.id) throw new Error('返回的编辑器与目标不匹配');
      this.register(state);
    }
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.resolve(result);
    return true;
  }
  remove(editorId: string) {
    this.closedEditors.add(editorId);
    if (this.closedEditors.size > 1000) this.closedEditors.delete(this.closedEditors.values().next().value!);
    this.editors.delete(editorId);
    for (const waiter of [...(this.commandWaiters.get(editorId) ?? [])]) waiter(undefined);
    for (const [id, pending] of this.pending) if (pending.command.editorId === editorId) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve({ status: 'failed', message: '目标预览已关闭，操作结果未确认' });
    }
  }
  close() { for (const id of this.editors.keys()) this.remove(id); }
}

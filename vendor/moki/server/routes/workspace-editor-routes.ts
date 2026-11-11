import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WorkspaceEditorResultSchema, WorkspaceEditorStateSchema } from '../../shared/workspace-editor-contract.js';
import type { WorkspaceEditorBridge } from '../services/workspace-editor-bridge.js';

export function registerWorkspaceEditorRoutes(app: FastifyInstance, bridge: WorkspaceEditorBridge) {
  app.post('/api/workspace/editors/register',async(request,reply)=>{
    const parsed=WorkspaceEditorStateSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:'编辑器状态无效'});
    try{bridge.register(parsed.data);return {registered:true};}catch(error){return reply.code(409).send({error:String(error)});}
  });
  app.post('/api/workspace/editors/poll', async (request, reply) => {
    const parsed = WorkspaceEditorStateSchema.extend({ waitMs: z.number().int().min(0).max(8_000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: '编辑器状态无效' });
    try {
      const { waitMs = 0, ...state } = parsed.data;
      bridge.register(state);
      return { command: await bridge.waitForCommand(state.editorId, waitMs) ?? null };
    } catch (error) { return reply.code(409).send({ error: String(error) }); }
  });
  app.post('/api/workspace/editors/result', async (request, reply) => {
    const parsed = z.object({ editorId: z.string().uuid(), requestId: z.string().uuid(), result: WorkspaceEditorResultSchema, state: WorkspaceEditorStateSchema.optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: '编辑器结果无效' });
    try { return { accepted: bridge.complete(parsed.data.editorId, parsed.data.requestId, parsed.data.result, parsed.data.state) }; }
    catch (error) { return reply.code(409).send({ error: String(error) }); }
  });
  app.post('/api/workspace/editors/close', async (request, reply) => {
    const parsed = z.object({ editorId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: '编辑器参数无效' });
    bridge.remove(parsed.data.editorId);
    return { closed: true };
  });
}

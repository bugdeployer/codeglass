import { packageVersion } from './paths.ts'
import type { Registry } from './projects.ts'
import { contractDescription } from '../shared/contracts.ts'
import { mappingInput } from './contracts.ts'
import { FULL_SCHEMA, PATCH_SCHEMA } from './arch.ts'
import { ingestActivity } from './activity.ts'

// Stateless MCP JSON-RPC endpoint: cooperative agents can request the same contracts and
// report explicit intent; native hooks cover ordinary read/edit/patch calls automatically.
export function mcpRequest(registry: Registry, request: any) {
  const id = request.id ?? null
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  const fail = (message: string) => ({ jsonrpc: '2.0', id, error: { code: -32602, message } })
  if (request.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'codeglass', version: packageVersion() }, instructions: 'Use get_visualizer_context for canonical connection types, schema evidence and IO contracts. Use report_activity before/after edits; report refactoring only when that is your explicit intent.' })
  if (request.method === 'ping') return reply({})
  if (request.method === 'tools/list') return reply({ tools: [
    { name: 'get_visualizer_context', description: 'Read the visualizer contract and optional project scanner context.', inputSchema: { type: 'object', properties: { cwd: { type: 'string' } }, additionalProperties: false }, outputSchema: { type: 'object', properties: { input: { type: 'object' }, outputSchemas: { type: 'object' } }, required: ['input', 'outputSchemas'] } },
    { name: 'report_activity', description: 'Report explicit building, editing, refactoring, reading, testing, deleting or working intent. Send the same callId with phase post to finish.', inputSchema: { type: 'object', properties: { cwd: { type: 'string' }, provider: { type: 'string', enum: ['claude', 'codex'] }, path: { type: 'string' }, action: { type: 'string', enum: contractDescription.activity.actions }, phase: { type: 'string', enum: ['pre', 'post'] }, sessionId: { type: 'string' }, callId: { type: 'string' } }, required: ['cwd', 'provider', 'path', 'action', 'phase', 'sessionId', 'callId'], additionalProperties: false }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, matched: { type: 'boolean' } }, required: ['ok', 'matched'] } },
  ] })
  if (request.method === 'tools/call') {
    const args = request.params?.arguments ?? {}
    if (!args || typeof args !== 'object' || Array.isArray(args)) return fail('Arguments must be an object')
    let result: unknown
    if (request.params?.name === 'get_visualizer_context') {
      if (Object.keys(args).some(key => key !== 'cwd') || (args.cwd !== undefined && typeof args.cwd !== 'string')) return fail('Invalid context arguments')
      const p = typeof args.cwd === 'string' ? registry.owner(args.cwd) : undefined
      result = { input: p?.analysis ? mappingInput(p.analysis, (file) => p.analyzer.contentOf(file), 0) : contractDescription, outputSchemas: { full: FULL_SCHEMA, patch: PATCH_SCHEMA } }
    } else if (request.params?.name === 'report_activity') {
      if (Object.keys(args).some(key => !['cwd', 'provider', 'path', 'action', 'phase', 'sessionId', 'callId'].includes(key)) || typeof args.cwd !== 'string' || !['claude', 'codex'].includes(args.provider) || !contractDescription.activity.actions.includes(args.action) || !['pre', 'post'].includes(args.phase) || typeof args.path !== 'string' || typeof args.sessionId !== 'string' || typeof args.callId !== 'string') return fail('Invalid activity contract')
      result = ingestActivity(registry, args, args.provider)
    } else return fail('Unknown tool')
    return reply({ structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }], ...(request.params.name === 'report_activity' && !(result as any).matched ? { isError: true } : {}) })
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
}

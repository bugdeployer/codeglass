// One vocabulary for scanner evidence, model output, MCP, and every view.
export const CONTRACT_VERSION = 1 as const
export const CONNECTION_KINDS = ['http', 'import', 'read', 'write', 'data', 'sdk', 'event', 'queue', 'render', 'fk', 'other'] as const
export type ConnectionKind = typeof CONNECTION_KINDS[number]
export const EFFECTS = ['ui', 'request', 'logic', 'read', 'write', 'external', 'event', 'response'] as const
export const VALUE_TYPES = ['string', 'number', 'boolean', 'object', 'array', 'null', 'unknown'] as const
export type IOField = { name: string; type: typeof VALUE_TYPES[number]; description: string }
export type IOContract = { input: IOField[]; output: IOField[] }
export const ACTIVITY_ACTIONS = ['building', 'editing', 'refactoring', 'reading', 'testing', 'deleting', 'working'] as const
export type ActivityAction = typeof ACTIVITY_ACTIONS[number]
export type SchemaLinkKind = 'fk' | 'many_to_many' | 'code_join'
export const CONNECTION_LABEL: Record<ConnectionKind, string> = {
  http: 'HTTP call', import: 'Code dependency', read: 'Data read', write: 'Data write', data: 'Data access',
  sdk: 'External SDK', event: 'Event', queue: 'Queue', render: 'Renders', fk: 'Foreign key', other: 'Other connection',
}
export const IO_SCHEMA = {
  type: 'array', maxItems: 4,
  items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: [...VALUE_TYPES] }, description: { type: 'string' } }, required: ['name', 'type', 'description'] },
}
export function valueType(raw: string): IOField['type'] {
  if (/\[\]|\barray\b/i.test(raw)) return 'array'
  if (/bool/i.test(raw)) return 'boolean'
  if (/int|float|double|decimal|numeric|real|number/i.test(raw)) return 'number'
  if (/json|object/i.test(raw)) return 'object'
  if (/str|text|char|uuid|date|time|enum/i.test(raw)) return 'string'
  return 'unknown'
}
export const ioFields = (value: unknown): IOField[] => Array.isArray(value) ? value.filter((f) => f && typeof f.name === 'string' && VALUE_TYPES.includes(f.type)).slice(0, 4).map((f) => ({ name: f.name, type: f.type, description: typeof f.description === 'string' ? f.description : '' })) : []
export function connectionKind(value: unknown): ConnectionKind {
  // Old persisted maps used db for table access. Unknown operations stay explicitly generic.
  if (value === 'db') return 'data'
  return CONNECTION_KINDS.includes(value as ConnectionKind) ? value as ConnectionKind : 'other'
}
export const contractDescription = {
  contractVersion: CONTRACT_VERSION,
  featureCard: { required: ['id', 'name', 'kind', 'summary', 'input', 'output', 'paths', 'entryPoints', 'tables', 'modules'], moduleRequired: ['id', 'name', 'summary', 'layer', 'paths', 'keyFiles', 'input', 'output'], systemKinds: ['core', 'supporting', 'generic', 'platform', 'external'], moduleLayers: ['ui', 'api', 'logic', 'data', 'job', 'other'] },
  connectionKinds: CONNECTION_LABEL,
  effects: EFFECTS,
  io: { input: 'Typed values consumed', output: 'Typed values produced', fieldTypes: VALUE_TYPES, unknown: 'Use unknown or an empty array when evidence is absent. Never infer types from a display label.' },
  schemaKinds: { fk: 'Declared foreign key', many_to_many: 'Junction-table relationship', code_join: 'Join observed in source only' },
  examples: {
    feature: { name: 'Orders', input: [{ name: 'orderId', type: 'string', description: 'Identifier read from a route parameter' }], output: [{ name: 'order', type: 'object', description: 'Order object returned by the handler' }] },
    connection: { kind: 'read', label: 'loads the order', input: [{ name: 'orderId', type: 'string', description: 'Lookup key' }], output: [{ name: 'order', type: 'object', description: 'Returned row' }] },
    unknown: 'For an observed returned value with an unclear type, retain its name and use type unknown. Empty arrays mean no documented boundary values.',
  },
  activity: { actions: ACTIVITY_ACTIONS, phases: ['pre', 'post'], refactoring: 'Must be reported explicitly; do not infer intent from a file write.' },
}

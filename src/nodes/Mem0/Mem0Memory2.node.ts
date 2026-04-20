import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription, ISupplyDataFunctions, SupplyData } from 'n8n-workflow'
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow'
import { extractResults, mem0ApiRequest } from './GenericFunctions'

declare const require: any

let HumanMessage: any
let AIMessage: any
let SystemMessage: any
let logWrapper: any
;(function loadDeps() {
  const messageCandidates = ['@langchain/core/messages', 'langchain/messages']
  for (const moduleName of messageCandidates) {
    try {
      const loaded = require(moduleName)
      if (loaded?.HumanMessage && loaded?.AIMessage) {
        HumanMessage = loaded.HumanMessage
        AIMessage = loaded.AIMessage
        SystemMessage = loaded.SystemMessage || loaded.HumanMessage
        break
      }
    } catch {
      // continue
    }
  }

  if (!HumanMessage || !AIMessage) {
    class BaseMessage {
      content: string
      lc_namespace = ['langchain_core', 'messages']
      lc_serializable = true
      additional_kwargs = {}

      constructor(content: string) {
        this.content = content
      }
    }
    HumanMessage = class extends BaseMessage {
      _getType() {
        return 'human'
      }
      get type() {
        return 'human'
      }
    }
    AIMessage = class extends BaseMessage {
      _getType() {
        return 'ai'
      }
      get type() {
        return 'ai'
      }
    }
    SystemMessage = class extends BaseMessage {
      _getType() {
        return 'system'
      }
      get type() {
        return 'system'
      }
    }
  }

  try {
    const aiUtils = require('@n8n/ai-utilities')
    logWrapper = aiUtils.logWrapper
  } catch {
    logWrapper = null
  }
})()

type RetrievalMode = 'basic' | 'summary' | 'semantic' | 'semanticV2' | 'hybrid'

type ScopeParams = {
  user_id: string
  agent_id?: string
  app_id?: string
  run_id?: string
}

type HybridScored = {
  m: Record<string, unknown>
  semanticScore: number
  recencyScore: number
  hybrid: number
}

function toSystemPayload(memories: Array<Record<string, unknown>>): Array<{ role: 'system'; content: string }> {
  return memories.map((m) => ({
    role: 'system',
    content: String(m.memory ?? m.text ?? JSON.stringify(m))
  }))
}

function toLangchainMessage(memory: { role?: string; content?: string }): any {
  const content = String(memory?.content ?? '')
  const role = String(memory?.role || '').toLowerCase()

  if (role === 'assistant' || role === 'ai') return new AIMessage(content)
  if (role === 'user' || role === 'human') return new HumanMessage(content)
  return new SystemMessage(content)
}

function wrapMemoryResponse(memory: any, ctx: ISupplyDataFunctions): any {
  if (typeof logWrapper === 'function') {
    return logWrapper(memory, ctx)
  }
  return memory
}

function buildScope(threadId: string, advanced: Record<string, unknown>): ScopeParams {
  const userId = String(advanced.userId ?? '').trim() || threadId
  const scope: ScopeParams = { user_id: userId }

  const agentId = String(advanced.agentId ?? '').trim()
  const appId = String(advanced.appId ?? '').trim()
  const runId = String(advanced.runId ?? '').trim()

  if (agentId) scope.agent_id = agentId
  if (appId) scope.app_id = appId
  if (runId) scope.run_id = runId

  return scope
}

function safeNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

class Mem0ConversationStore {
  private readonly maxMessageLength: number

  constructor(
    private readonly ctx: ISupplyDataFunctions,
    private readonly scope: ScopeParams,
    options: { maxMessageLength: number }
  ) {
    this.maxMessageLength = options.maxMessageLength
  }

  private normalize(role: 'user' | 'assistant', content: string): string {
    const normalized = String(content || '').trim()
    if (!normalized) return ''

    if (normalized.length > this.maxMessageLength) {
      throw new NodeOperationError(
        this.ctx.getNode(),
        `${role === 'user' ? 'User' : 'Assistant'} message is too long. Maximum supported length is ${this.maxMessageLength} characters.`
      )
    }

    return normalized
  }

  async addConversationTurn(userMessage?: string, assistantMessage?: string): Promise<void> {
    const user = this.normalize('user', userMessage || '')
    const assistant = this.normalize('assistant', assistantMessage || '')

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    if (user) messages.push({ role: 'user', content: user })
    if (assistant) messages.push({ role: 'assistant', content: assistant })
    if (messages.length === 0) return

    await mem0ApiRequest.call(this.ctx, 'POST', '/memories', {
      messages,
      infer: false,
      metadata: {
        source: 'n8n_mem0_memory2',
        channel: 'chat',
        memory_type: 'conversation'
      },
      ...this.scope
    })
  }

  async addUserMessage(message: string): Promise<void> {
    const user = this.normalize('user', message)
    if (!user) return

    await mem0ApiRequest.call(this.ctx, 'POST', '/memories', {
      messages: [{ role: 'user', content: user }],
      infer: false,
      metadata: {
        source: 'n8n_mem0_memory2',
        channel: 'chat',
        memory_type: 'conversation'
      },
      ...this.scope
    })
  }

  async addAIMessage(message: string): Promise<void> {
    const assistant = this.normalize('assistant', message)
    if (!assistant) return

    await mem0ApiRequest.call(this.ctx, 'POST', '/memories', {
      messages: [{ role: 'assistant', content: assistant }],
      infer: false,
      metadata: {
        source: 'n8n_mem0_memory2',
        channel: 'chat',
        memory_type: 'conversation'
      },
      ...this.scope
    })
  }

  async addAIChatMessage(message: string): Promise<void> {
    await this.addAIMessage(message)
  }

  async getMessages(): Promise<any[]> {
    return []
  }

  async clear(): Promise<void> {
    return
  }
}

async function buildPayload(
  ctx: ISupplyDataFunctions | IExecuteFunctions,
  itemIndex: number,
  runtimeValues?: any,
  options?: { forceSearch?: boolean }
): Promise<{ memoryKey: string; payload: Array<{ role: 'system'; content: string }> }> {
  const requestedRetrievalMode = ctx.getNodeParameter('retrievalMode', itemIndex) as RetrievalMode
  const retrievalMode: RetrievalMode =
    options?.forceSearch && (requestedRetrievalMode === 'basic' || requestedRetrievalMode === 'summary')
      ? 'semantic'
      : requestedRetrievalMode
  const memoryKey = String(ctx.getNodeParameter('memoryKey', itemIndex, 'chat_history'))
  const threadId = String(ctx.getNodeParameter('threadId', itemIndex, '') || '').trim()
  const advanced = (ctx.getNodeParameter('advanced', itemIndex, {}) || {}) as Record<string, unknown>
  const configuredQuery = String(ctx.getNodeParameter('query', itemIndex, '') || '').trim()
  const runtimeQuery = String(
    runtimeValues?.input ||
      runtimeValues?.query ||
      runtimeValues?.human_input ||
      runtimeValues?.chatInput ||
      runtimeValues?.text ||
      runtimeValues?.message ||
      ''
  ).trim()
  const query = configuredQuery || runtimeQuery || 'user profile, preferences, and important facts'
  const scope = buildScope(threadId, advanced)

  if (retrievalMode === 'semantic' || retrievalMode === 'semanticV2' || retrievalMode === 'hybrid') {
    const body: Record<string, unknown> = { query, ...scope }

    const topK = safeNumber(advanced.topK, 25)
    if (topK > 0) body.top_k = topK

    if (advanced.rerank !== undefined) body.rerank = Boolean(advanced.rerank)
    if (typeof advanced.fields === 'string' && advanced.fields.trim()) {
      body.fields = advanced.fields
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0)
    }

    if (retrievalMode === 'semanticV2' || retrievalMode === 'hybrid') {
      try {
        const filters = typeof advanced.filters === 'string' ? JSON.parse(advanced.filters) : advanced.filters || {}
        if (filters && typeof filters === 'object') body.filters = filters
      } catch {
        // Keep behavior permissive like compiled reference.
      }
    }

    const semRes = await mem0ApiRequest.call(ctx, 'POST', '/search', body)
    const semMemories = extractResults(semRes) as Array<Record<string, unknown>>

    if (retrievalMode === 'hybrid') {
      const recRes = await mem0ApiRequest.call(ctx, 'GET', '/memories', {}, scope)
      let recents = extractResults(recRes) as Array<Record<string, unknown>>

      const lastN = safeNumber(advanced.lastN, 20)
      if (lastN > 0) recents = recents.slice(-lastN)

      const alpha = safeNumber(advanced.alpha, 0.65)
      const halfLife = Math.max(1, safeNumber(advanced.halfLifeHours, 48))
      const maxReturn = Math.max(1, safeNumber(advanced.maxReturn, 30))
      const mmr = advanced.mmr !== undefined ? Boolean(advanced.mmr) : true
      const mmrLambda = safeNumber(advanced.mmrLambda, 0.5)
      const ln2 = Math.log(2)
      const now = Date.now()

      const idOf = (m: Record<string, unknown>) =>
        String(m.id ?? m.uuid ?? m._id ?? m.memory_id ?? m.pk ?? JSON.stringify(m).slice(0, 1000))
      const createdOf = (m: Record<string, unknown>) =>
        (m.created_at ?? m.createdAt ?? m.timestamp ?? m.time ?? m.date) as string | number | undefined
      const scoreOf = (m: Record<string, unknown>) => safeNumber(m.score ?? m.similarity ?? m.relevance ?? m.rank, 1)

      const merged = new Map<string, HybridScored>()

      for (const m of semMemories) {
        const id = idOf(m)
        const created = createdOf(m)
        let recency = 0.5
        if (created !== undefined) {
          const t = new Date(created).getTime()
          if (!Number.isNaN(t)) {
            const ageH = Math.max(0, (now - t) / 3600000)
            recency = Math.exp(-ln2 * (ageH / halfLife))
          }
        }
        const sem = scoreOf(m)
        const hybrid = alpha * sem + (1 - alpha) * recency
        merged.set(id, { m, semanticScore: sem, recencyScore: recency, hybrid })
      }

      for (const m of recents) {
        const id = idOf(m)
        const created = createdOf(m)
        let recency = 0.7
        if (created !== undefined) {
          const t = new Date(created).getTime()
          if (!Number.isNaN(t)) {
            const ageH = Math.max(0, (now - t) / 3600000)
            recency = Math.exp(-ln2 * (ageH / halfLife))
          }
        }
        const prev = merged.get(id)
        const sem = prev?.semanticScore ?? 0
        const hybrid = alpha * sem + (1 - alpha) * recency
        merged.set(id, { m: prev?.m ?? m, semanticScore: sem, recencyScore: recency, hybrid })
      }

      let ranked = Array.from(merged.values()).sort((a, b) => b.hybrid - a.hybrid)

      if (mmr && ranked.length > 2) {
        const selected: HybridScored[] = []
        const rest = [...ranked]
        const first = rest.shift()
        if (first) selected.push(first)

        while (selected.length < Math.min(maxReturn, ranked.length) && rest.length > 0) {
          let bestIdx = 0
          let bestScore = Number.NEGATIVE_INFINITY
          for (let i = 0; i < rest.length; i++) {
            const cand = rest[i]
            const rel = cand.hybrid
            const sim = Math.max(...selected.map((s) => 1 - Math.abs(s.hybrid - cand.hybrid)))
            const mmrScore = mmrLambda * rel - (1 - mmrLambda) * sim
            if (mmrScore > bestScore) {
              bestScore = mmrScore
              bestIdx = i
            }
          }
          selected.push(rest.splice(bestIdx, 1)[0])
        }
        ranked = selected
      }

      const finalMemories = ranked.slice(0, maxReturn).map((r) => r.m)
      return { memoryKey, payload: toSystemPayload(finalMemories) }
    }

    return { memoryKey, payload: toSystemPayload(semMemories) }
  }

  const res = await mem0ApiRequest.call(ctx, 'GET', '/memories', {}, scope)
  let memories = extractResults(res) as Array<Record<string, unknown>>
  const lastN = safeNumber(advanced.lastN, 20)
  if (lastN > 0) memories = memories.slice(-lastN)

  if (retrievalMode === 'summary') {
    const text = memories
      .map((m) => String(m.memory ?? m.text ?? m.value ?? ''))
      .filter((v) => v.length > 0)
      .join('\n')
    return { memoryKey, payload: [{ role: 'system', content: `Summary of memories:\n${text}` }] }
  }

  return { memoryKey, payload: toSystemPayload(memories) }
}

export class Mem0Memory2 implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Mem0 Memory 2',
    name: 'mem0Memory2',
    icon: 'file:mem0.svg',
    group: ['transform'],
    version: 1,
    description: 'Test memory node with hybrid retrieval logic (self-hosted only)',
    defaults: { name: 'Mem0 Memory 2' },
    inputs: [],
    outputs: [NodeConnectionTypes.AiMemory],
    outputNames: ['Memory'],
    credentials: [{ name: 'mem0SelfHostedApi', required: true }],
    properties: [
      {
        displayName: 'Thread ID',
        name: 'threadId',
        type: 'string',
        default: '={{ $json.threadId || $executionId }}',
        description: 'Unique conversation/thread ID used as user_id fallback'
      },
      {
        displayName: 'Retrieval Mode',
        name: 'retrievalMode',
        type: 'options',
        options: [
          { name: 'Basic', value: 'basic', description: 'Return raw memories (recent/all)' },
          { name: 'Summary', value: 'summary', description: 'Return a simple memory summary' },
          { name: 'Semantic (v1)', value: 'semantic', description: 'Semantic search with rerank option' },
          { name: 'Semantic (v2)', value: 'semanticV2', description: 'Semantic search with advanced filters' },
          { name: 'Hybrid', value: 'hybrid', description: 'Combine recent + semantic with hybrid ranking' }
        ],
        default: 'basic'
      },
      {
        displayName: 'Query',
        name: 'query',
        type: 'string',
        default: '={{ $json.query || $json.lastUserMessage || "" }}',
        description: 'Natural-language query for memory retrieval',
        displayOptions: {
          show: {
            retrievalMode: ['semantic', 'semanticV2', 'hybrid']
          }
        }
      },
      {
        displayName: 'Memory Key',
        name: 'memoryKey',
        type: 'string',
        default: 'chat_history',
        description: 'Key used in returned memory object'
      },
      {
        displayName: 'Advanced',
        name: 'advanced',
        type: 'collection',
        placeholder: 'Options',
        default: {},
        options: [
          { displayName: 'User ID', name: 'userId', type: 'string', default: '' },
          { displayName: 'Agent ID', name: 'agentId', type: 'string', default: '' },
          { displayName: 'App ID', name: 'appId', type: 'string', default: '' },
          { displayName: 'Run ID', name: 'runId', type: 'string', default: '' },
          {
            displayName: 'Top K',
            name: 'topK',
            type: 'number',
            typeOptions: { minValue: 1 },
            default: 25,
            description: 'Number of memories to retrieve'
          },
          {
            displayName: 'Rerank',
            name: 'rerank',
            type: 'boolean',
            default: true,
            description: 'Enable relevance reranking',
            displayOptions: { show: { '/retrievalMode': ['semantic', 'semanticV2', 'hybrid'] } }
          },
          {
            displayName: 'Fields (Comma Separated)',
            name: 'fields',
            type: 'string',
            default: '',
            description: 'Specific response fields to return',
            displayOptions: { show: { '/retrievalMode': ['semantic', 'semanticV2', 'hybrid'] } }
          },
          {
            displayName: 'Filters (JSON)',
            name: 'filters',
            type: 'json',
            default: '{}',
            description: 'Advanced search filters',
            displayOptions: { show: { '/retrievalMode': ['semanticV2', 'hybrid'] } }
          },
          {
            displayName: 'Last N (Recent)',
            name: 'lastN',
            type: 'number',
            default: 20,
            description: 'If > 0, returns only the latest N memories in basic/summary and recent part of hybrid',
            displayOptions: { show: { '/retrievalMode': ['basic', 'summary', 'hybrid'] } }
          },
          {
            displayName: 'Alpha (Semantic Weight)',
            name: 'alpha',
            type: 'number',
            typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
            default: 0.65,
            description: 'Semantic relevance weight in hybrid score',
            displayOptions: { show: { '/retrievalMode': ['hybrid'] } }
          },
          {
            displayName: 'Half-Life (Hours)',
            name: 'halfLifeHours',
            type: 'number',
            typeOptions: { minValue: 1 },
            default: 48,
            description: 'Half-life in hours for time decay',
            displayOptions: { show: { '/retrievalMode': ['hybrid'] } }
          },
          {
            displayName: 'Max Return',
            name: 'maxReturn',
            type: 'number',
            typeOptions: { minValue: 1 },
            default: 30,
            description: 'Final number of memories returned to the agent',
            displayOptions: { show: { '/retrievalMode': ['hybrid'] } }
          },
          {
            displayName: 'MMR (Diversity)',
            name: 'mmr',
            type: 'boolean',
            default: true,
            description: 'Apply Maximal Marginal Relevance diversity',
            displayOptions: { show: { '/retrievalMode': ['hybrid'] } }
          },
          {
            displayName: 'MMR Lambda',
            name: 'mmrLambda',
            type: 'number',
            typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
            default: 0.5,
            description: 'Balance between relevance and diversity in MMR',
            displayOptions: { show: { '/retrievalMode': ['hybrid'] } }
          }
        ]
      }
    ]
  }

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const threadId = String(this.getNodeParameter('threadId', itemIndex, '') || '').trim()
    const advanced = (this.getNodeParameter('advanced', itemIndex, {}) || {}) as Record<string, unknown>
    const scope = buildScope(threadId, advanced)
    const conversationStore = new Mem0ConversationStore(this, scope, { maxMessageLength: 10000 })

    const memory = {
      memoryKey: String(this.getNodeParameter('memoryKey', itemIndex, 'chat_history') || 'chat_history'),
      returnMessages: true,
      inputKey: 'input',
      outputKey: 'output',
      chatHistory: conversationStore,
      loadMemoryVariables: async (values: any) => {
        const { memoryKey, payload } = await buildPayload(this, itemIndex, values, { forceSearch: true })
        return {
          [memoryKey]: payload.map((m) => toLangchainMessage(m))
        }
      },
      saveContext: async (inputValues: any, outputValues: any) => {
        const userInput = String(
          inputValues?.input ||
            inputValues?.query ||
            inputValues?.human_input ||
            inputValues?.chatInput ||
            inputValues?.text ||
            inputValues?.message ||
            ''
        ).trim()
        const assistantOutput = String(
          outputValues?.output || outputValues?.response || outputValues?.text || outputValues?.answer || ''
        ).trim()
        await conversationStore.addConversationTurn(userInput, assistantOutput)
      },
      clear: async () => {
        await conversationStore.clear()
      }
    }

    const wrappedMemory = wrapMemoryResponse(memory, this)
    if (wrappedMemory && typeof wrappedMemory === 'object') {
      wrappedMemory.memoryKey = wrappedMemory.memoryKey || 'chat_history'
    }

    return { response: wrappedMemory }
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData()
    const returnData: INodeExecutionData[] = []
    const count = Math.max(items.length, 1)

    for (let i = 0; i < count; i++) {
      const { memoryKey, payload } = await buildPayload(this, i)
      returnData.push({
        json: { [memoryKey]: payload }
      })
    }

    return [returnData]
  }
}

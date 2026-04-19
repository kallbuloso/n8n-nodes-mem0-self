import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription, ISupplyDataFunctions, SupplyData } from 'n8n-workflow'
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow'
import { extractResults, mem0ApiRequest } from './GenericFunctions'

declare const require: any

let HumanMessage: any
let AIMessage: any
let SystemMessage: any
let BufferWindowMemory: any
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
    const memory = require('@langchain/classic/memory')
    BufferWindowMemory = memory.BufferWindowMemory || memory.BufferMemory
  } catch {
    BufferWindowMemory = null
  }

  try {
    const aiUtils = require('@n8n/ai-utilities')
    logWrapper = aiUtils.logWrapper
  } catch {
    logWrapper = null
  }
})()

function toMessageContent(memory: any): string {
  return memory?.memory ?? memory?.text ?? memory?.content ?? ''
}

function toLangchainMessage(memory: any): any {
  const content = toMessageContent(memory)
  const role = String(memory?.metadata?.role || memory?.role || '').toLowerCase()

  const createMsg = (MsgClass: any) => {
    const msg = new MsgClass(content)
    msg.additional_kwargs = memory?.additional_kwargs || {}
    msg.response_metadata = memory?.response_metadata || {}
    return msg
  }

  if (role === 'user' || role === 'human') return createMsg(HumanMessage)
  if (role === 'assistant' || role === 'ai') return createMsg(AIMessage)
  return createMsg(SystemMessage)
}

function wrapMemoryResponse(memory: any, ctx: ISupplyDataFunctions): any {
  if (typeof logWrapper === 'function') {
    return logWrapper(memory, ctx)
  }
  return memory
}

type Mem0Scope = {
  user_id: string
  agent_id: string
  run_id?: string
}

type ConversationCacheEntry = {
  ts: number
  entries: any[]
}

class Mem0ChatHistory {
  private readonly maxMessageLength: number
  private readonly inferOnStore: boolean
  private readonly storeStrategy: 'conversation' | 'facts_only'
  private static readonly CONVERSATION_CACHE_TTL_MS = 120000
  private static readonly conversationCache = new Map<string, ConversationCacheEntry>()

  static getScopedCacheKey(scope: Mem0Scope, maxMessages: number): string {
    return `strict|${scope.user_id}|${scope.agent_id}|${scope.run_id || ''}|${maxMessages}`
  }

  static getGlobalCacheKey(userId: string, agentId: string, maxMessages: number): string {
    return `global|${userId}|${agentId}|${maxMessages}`
  }

  static getConversationCache(key: string): any[] | null {
    const entry = this.conversationCache.get(key)
    if (!entry) return null
    if (Date.now() - entry.ts > this.CONVERSATION_CACHE_TTL_MS) {
      this.conversationCache.delete(key)
      return null
    }
    return entry.entries
  }

  static setConversationCache(key: string, entries: any[]): void {
    this.conversationCache.set(key, {
      ts: Date.now(),
      entries
    })
  }

  static appendToConversationCache(key: string, incoming: any[], maxMessages: number): void {
    const entry = this.conversationCache.get(key)
    if (!entry || !Array.isArray(entry.entries)) return
    const merged = [...entry.entries, ...incoming].slice(-maxMessages)
    this.conversationCache.set(key, {
      ts: Date.now(),
      entries: merged
    })
  }

  constructor(
    private readonly ctx: ISupplyDataFunctions,
    private readonly scope: Mem0Scope,
    options: { maxMessageLength: number; inferOnStore: boolean; storeStrategy: 'conversation' | 'facts_only' }
  ) {
    this.maxMessageLength = options.maxMessageLength
    this.inferOnStore = options.inferOnStore
    this.storeStrategy = options.storeStrategy
  }

  private normalizeRole(message: any): 'user' | 'assistant' {
    const role = String(message?.role || message?.type || message?._getType?.() || '').toLowerCase()
    if (role === 'assistant' || role === 'ai') return 'assistant'
    return 'user'
  }

  private normalizeContent(message: any): string {
    if (typeof message === 'string') return message
    return String(message?.content ?? '')
  }

  private async append(role: 'user' | 'assistant', content: string): Promise<void> {
    if (this.storeStrategy === 'facts_only' && role !== 'user') {
      return
    }

    const normalized = String(content || '').trim()
    if (!normalized) return
    if (normalized.length > this.maxMessageLength) {
      throw new NodeOperationError(
        this.ctx.getNode(),
        `${role === 'user' ? 'User' : 'Assistant'} message is too long. Maximum supported length is ${this.maxMessageLength} characters.`
      )
    }

    await mem0ApiRequest.call(this.ctx, 'POST', '/memories', {
      messages: [{ role, content: normalized }],
      infer: this.inferOnStore,
      metadata: {
        source: 'n8n_mem0_memory_hybrid',
        role,
        channel: 'chat',
        memory_type: this.storeStrategy === 'facts_only' ? 'fact' : 'conversation'
      },
      ...this.scope
    })
  }

  async getMessages(): Promise<any[]> {
    return []
  }

  async addMessage(message: any): Promise<void> {
    const role = this.normalizeRole(message)
    const content = this.normalizeContent(message)
    await this.append(role, content)
  }

  async addMessages(messages: any[]): Promise<void> {
    for (const message of messages || []) {
      await this.addMessage(message)
    }
  }

  async addUserMessage(message: string): Promise<void> {
    await this.append('user', message)
  }

  async addAIMessage(message: string): Promise<void> {
    await this.append('assistant', message)
  }

  async addAIChatMessage(message: string): Promise<void> {
    await this.append('assistant', message)
  }

  async clear(): Promise<void> {
    return
  }
}

export class Mem0Memory implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Mem0 Chat Memory',
    name: 'mem0Memory',
    icon: 'file:mem0.svg',
    group: ['transform'],
    version: 1,
    description: 'Persistent chat memory for AI Agent using Mem0 Self-Hosted OSS REST API',
    defaults: { name: 'Mem0 Chat Memory' },
    inputs: [],
    outputs: [NodeConnectionTypes.AiMemory],
    outputNames: ['Memory'],
    credentials: [{ name: 'mem0SelfHostedApi', required: true }],
    properties: [
      {
        displayName: 'User ID',
        name: 'userId',
        type: 'string',
        default: '',
        required: true,
        description: 'Required memory owner user identifier'
      },
      {
        displayName: 'Agent ID',
        name: 'agentId',
        type: 'string',
        default: '',
        required: true,
        description: 'Required memory owner agent identifier'
      },
      {
        displayName: 'Run ID',
        name: 'runId',
        type: 'string',
        default: '',
        description: 'Optional conversation/session identifier'
      },
      {
        displayName: 'Top K',
        name: 'topK',
        type: 'number',
        default: 3,
        typeOptions: { minValue: 1, maxValue: 50 },
        description: 'Maximum number of relevant memories to retrieve per query'
      },
      {
        displayName: 'Memory Mode',
        name: 'memoryMode',
        type: 'options',
        default: 'conversation_pairs',
        options: [
          {
            name: 'Conversation Pairs',
            value: 'conversation_pairs',
            description: 'Uses recent conversation buffer with semantic fallback options'
          },
          {
            name: 'Semantic Facts',
            value: 'semantic_facts',
            description: 'Uses semantic search retrieval only'
          }
        ],
        description: 'Primary retrieval mode for memory context'
      },
      {
        displayName: 'Buffer Limit (Interactions)',
        name: 'bufferLimit',
        type: 'number',
        default: 6,
        typeOptions: { minValue: 1, maxValue: 200 },
        description: 'How many latest user+assistant interactions to include in buffer mode',
        displayOptions: {
          show: {
            memoryMode: ['conversation_pairs']
          }
        }
      },
      {
        displayName: 'Fallback to Search on Buffer Miss',
        name: 'fallbackToSearchOnBufferMiss',
        type: 'boolean',
        default: true,
        description: 'When recent buffer appears unrelated to current query, fallback to semantic search',
        displayOptions: {
          show: {
            memoryMode: ['conversation_pairs']
          }
        }
      },
      {
        displayName: 'Conversation Retrieval Policy',
        name: 'conversationRetrievalPolicy',
        type: 'options',
        default: 'smart_fallback',
        options: [
          {
            name: 'Smart Fallback (Recommended)',
            value: 'smart_fallback',
            description: 'Uses recent buffer and falls back to semantic search when needed'
          },
          {
            name: 'Search First',
            value: 'search_first',
            description: 'Always uses semantic search first, then recent buffer if empty'
          },
          {
            name: 'Buffer First',
            value: 'buffer_first',
            description: 'Always uses recent conversation buffer only'
          }
        ],
        description: 'How conversation mode chooses between recent buffer and semantic retrieval',
        displayOptions: {
          show: {
            memoryMode: ['conversation_pairs']
          }
        }
      },
      {
        displayName: 'Search Query (Optional)',
        name: 'searchQuery',
        type: 'string',
        default: '',
        description: 'Custom search query. If empty, uses user input from workflow context'
      },
      {
        displayName: 'Fallback Query',
        name: 'defaultQuery',
        type: 'string',
        default: 'user profile, preferences, and important facts',
        description: 'Fallback search query when no input is available'
      },
      {
        displayName: 'Rerank Results',
        name: 'rerank',
        type: 'boolean',
        default: false,
        description: 'Enable semantic reranking in Mem0 search for improved relevance'
      },
      {
        displayName: 'Search Mode',
        name: 'searchMode',
        type: 'options',
        default: 'balanced',
        options: [
          {
            name: 'Balanced (Recommended)',
            value: 'balanced',
            description: 'Prioritizes user factual memories with safe fallbacks'
          },
          {
            name: 'Strict Facts',
            value: 'strict_facts',
            description: 'Prefers user factual memories only'
          },
          {
            name: 'All Memories',
            value: 'all',
            description: 'Includes assistant memories and conversation turns'
          },
          {
            name: 'Legacy',
            value: 'legacy',
            description: 'Compatibility behavior from previous releases'
          }
        ],
        description: 'Retrieval strategy for search results filtering'
      },
      {
        displayName: 'Max Context Characters',
        name: 'maxContextChars',
        type: 'number',
        default: 450,
        typeOptions: { minValue: 100, maxValue: 8000 },
        description: 'Maximum total characters injected into AI context after retrieval'
      },
      {
        displayName: 'Include Assistant Memories',
        name: 'includeAssistantMemories',
        type: 'boolean',
        default: false,
        description: 'Whether assistant messages should be included in retrieved context'
      },
      {
        displayName: 'Store Strategy',
        name: 'storeStrategy',
        type: 'options',
        default: 'conversation',
        options: [
          {
            name: 'Conversation (Default)',
            value: 'conversation',
            description: 'Stores user and assistant turns'
          },
          {
            name: 'Facts Only',
            value: 'facts_only',
            description: 'Stores user factual signals only, avoids assistant noise'
          }
        ],
        description: 'How messages are persisted into memory'
      },
      {
        displayName: 'Fields (Comma Separated)',
        name: 'fields',
        type: 'string',
        default: '',
        description: 'Optional fields list for search response'
      },
      {
        displayName: 'Search Filters (JSON)',
        name: 'searchFilters',
        type: 'string',
        default: '',
        description: 'Optional JSON filters passed to Mem0 search payload'
      },
      {
        displayName: 'Allow Empty Context',
        name: 'allowEmptyContext',
        type: 'boolean',
        default: false,
        description: 'If disabled, retrieval automatically falls back before returning empty context'
      },
      {
        displayName: 'Infer on Store (Legacy)',
        name: 'infer',
        type: 'boolean',
        default: false,
        description: 'Legacy toggle kept for compatibility'
      },
      {
        displayName: 'Debug Memory Retrieval',
        name: 'debugMemory',
        type: 'boolean',
        default: false,
        description: 'Adds retrieval diagnostics metadata to help troubleshooting'
      }
    ]
  }

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const MAX_MESSAGE_LENGTH = 10000
    const MAX_QUERY_LENGTH = 2000
    const FALLBACK_QUERY = 'user profile, preferences, and important facts'

    const userId = String(this.getNodeParameter('userId', itemIndex, '') || '').trim()
    const agentId = String(this.getNodeParameter('agentId', itemIndex, '') || '').trim()
    const runId = String(this.getNodeParameter('runId', itemIndex, '') || '').trim()
    const topK = Math.min(50, Math.max(1, Math.floor(Number(this.getNodeParameter('topK', itemIndex, 3) || 3))))
    const memoryMode = String(this.getNodeParameter('memoryMode', itemIndex, 'conversation_pairs') || 'conversation_pairs') as
      | 'conversation_pairs'
      | 'semantic_facts'
    const bufferLimit = Math.max(1, Math.floor(Number(this.getNodeParameter('bufferLimit', itemIndex, 6) || 6)))
    const fallbackToSearchOnBufferMiss = Boolean(this.getNodeParameter('fallbackToSearchOnBufferMiss', itemIndex, true))
    const conversationRetrievalPolicy = String(this.getNodeParameter('conversationRetrievalPolicy', itemIndex, 'smart_fallback') || 'smart_fallback') as
      | 'smart_fallback'
      | 'search_first'
      | 'buffer_first'
    const searchQuery = String(this.getNodeParameter('searchQuery', itemIndex, '') || '').trim()
    const defaultQuery = String(this.getNodeParameter('defaultQuery', itemIndex, FALLBACK_QUERY) || FALLBACK_QUERY).trim()
    const rerank = Boolean(this.getNodeParameter('rerank', itemIndex, false))
    const searchMode = String(this.getNodeParameter('searchMode', itemIndex, 'balanced') || 'balanced') as
      | 'balanced'
      | 'strict_facts'
      | 'all'
      | 'legacy'
    const maxContextChars = Math.max(100, Math.floor(Number(this.getNodeParameter('maxContextChars', itemIndex, 450) || 450)))
    const includeAssistantMemories = Boolean(this.getNodeParameter('includeAssistantMemories', itemIndex, false))
    const storeStrategy = String(this.getNodeParameter('storeStrategy', itemIndex, 'conversation') || 'conversation') as 'conversation' | 'facts_only'
    const fieldsInput = String(this.getNodeParameter('fields', itemIndex, '') || '').trim()
    const searchFiltersInput = String(this.getNodeParameter('searchFilters', itemIndex, '') || '').trim()
    const allowEmptyContext = Boolean(this.getNodeParameter('allowEmptyContext', itemIndex, false))
    const inferOnStore = Boolean(this.getNodeParameter('infer', itemIndex, false))
    const debugMemory = Boolean(this.getNodeParameter('debugMemory', itemIndex, false))

    if (!userId || !agentId) {
      throw new NodeOperationError(this.getNode(), 'User ID and Agent ID are required.')
    }

    const scope: Mem0Scope = {
      user_id: userId,
      agent_id: agentId
    }
    if (runId) scope.run_id = runId

    const chatHistory = new Mem0ChatHistory(this, scope, {
      maxMessageLength: MAX_MESSAGE_LENGTH,
      inferOnStore,
      storeStrategy
    })
    const maxMessages = bufferLimit * 2
    const strictCacheKey = Mem0ChatHistory.getScopedCacheKey(scope, maxMessages)
    const globalCacheKey = Mem0ChatHistory.getGlobalCacheKey(scope.user_id, scope.agent_id, maxMessages)

    const appendRecentMessagesToCache = (inputValues: any, outputValues: any): void => {
      const userInput = String(inputValues?.input || inputValues?.query || inputValues?.human_input || inputValues?.chatInput || '').trim()
      const assistantOutput = String(outputValues?.output || outputValues?.response || outputValues?.text || '').trim()
      const now = new Date().toISOString()
      const incoming: any[] = []

      if (userInput) {
        incoming.push({
          memory: userInput,
          metadata: { role: 'user' },
          created_at: now
        })
      }

      if (assistantOutput && storeStrategy !== 'facts_only') {
        incoming.push({
          memory: assistantOutput,
          metadata: { role: 'assistant' },
          created_at: now
        })
      }

      if (incoming.length > 0) {
        Mem0ChatHistory.appendToConversationCache(strictCacheKey, incoming, maxMessages)
        Mem0ChatHistory.appendToConversationCache(globalCacheKey, incoming, maxMessages)
      }
    }

    const normalizeConversationEntries = (entries: any[]): any[] => {
      return entries
        .filter((entry: any) => {
          const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase()
          return role === 'user' || role === 'human' || role === 'assistant' || role === 'ai'
        })
        .sort((a: any, b: any) => {
          const aTs = new Date(a?.created_at || a?.updated_at || 0).getTime() || 0
          const bTs = new Date(b?.created_at || b?.updated_at || 0).getTime() || 0
          return aTs - bTs
        })
    }

    const loadConversationMessages = async (): Promise<any[]> => {
      const cachedStrict = Mem0ChatHistory.getConversationCache(strictCacheKey)
      if (cachedStrict) {
        return cachedStrict.map((entry: any) => toLangchainMessage(entry))
      }

      const strictScope: Record<string, unknown> = runId
        ? { user_id: scope.user_id, agent_id: scope.agent_id, run_id: scope.run_id }
        : { user_id: scope.user_id, agent_id: scope.agent_id }

      const response = await mem0ApiRequest.call(this, 'GET', '/memories', {}, strictScope)
      const strictResults = extractResults(response)
      const strictNormalized = normalizeConversationEntries(strictResults)

      let selected = strictNormalized.slice(-maxMessages)

      // Continuity support: if current run has little history, pull a small tail from previous runs.
      if (runId && selected.length < maxMessages) {
        let globalNormalized = Mem0ChatHistory.getConversationCache(globalCacheKey)
        if (!globalNormalized) {
          const globalResponse = await mem0ApiRequest.call(this, 'GET', '/memories', {}, {
            user_id: scope.user_id,
            agent_id: scope.agent_id
          })
          const globalResults = extractResults(globalResponse)
          globalNormalized = normalizeConversationEntries(globalResults)
          Mem0ChatHistory.setConversationCache(globalCacheKey, globalNormalized)
        }
        const strictIdentity = new Set(
          strictNormalized.map((entry: any) =>
            String(entry?.id || `${entry?.created_at || ''}|${entry?.metadata?.role || entry?.role || ''}|${toMessageContent(entry)}`)
          )
        )

        const previousOnly = globalNormalized.filter((entry: any) => {
          const key = String(entry?.id || `${entry?.created_at || ''}|${entry?.metadata?.role || entry?.role || ''}|${toMessageContent(entry)}`)
          return !strictIdentity.has(key)
        })
        const missing = Math.max(0, maxMessages - selected.length)
        if (missing > 0) {
          selected = [...previousOnly.slice(-missing), ...selected].slice(-maxMessages)
        }
      }

      Mem0ChatHistory.setConversationCache(strictCacheKey, selected)
      return selected.map((entry: any) => toLangchainMessage(entry))
    }

    const searchMessages = async (values: any): Promise<any[]> => {
      const extractedQuery = String(
          searchQuery ||
          values?.input || 
          values?.query || 
          values?.human_input || 
          values?.chatInput || 
          values?.text || 
          values?.message || 
          ''
        ).trim()
      const fallbackAnchor = defaultQuery || FALLBACK_QUERY
      const effectiveQuery = extractedQuery
        ? `${extractedQuery}\n${fallbackAnchor}`
        : fallbackAnchor

      if (effectiveQuery.length > MAX_QUERY_LENGTH) {
        throw new NodeOperationError(
          this.getNode(),
          `Search query is too long. Maximum supported length is ${MAX_QUERY_LENGTH} characters.`
        )
      }

      const fields = fieldsInput
        ? fieldsInput
            .split(',')
            .map((field) => field.trim())
            .filter((field) => field.length > 0)
        : undefined

      let searchFilters: Record<string, unknown> | undefined
      if (searchFiltersInput) {
        try {
          searchFilters = JSON.parse(searchFiltersInput)
        } catch {
          throw new NodeOperationError(this.getNode(), 'Search Filters (JSON) is not valid JSON.')
        }
      }

      const scopeCandidates: Array<Record<string, unknown>> = []
      scopeCandidates.push({ ...scope })
      scopeCandidates.push({ user_id: scope.user_id, agent_id: scope.agent_id })
      scopeCandidates.push({ user_id: scope.user_id })

      let results: any[] = []
      let hadSearchError = false
      let lastSearchError: unknown = null

      const searchCandidateMultiplier = 4
      const candidateTopK = Math.min(50, Math.max(topK, topK * searchCandidateMultiplier))
      const runScopedSearch = async (extraBody: Record<string, unknown> = {}): Promise<any[]> => {
        let scopedResults: any[] = []
        for (const scopeCandidate of scopeCandidates) {
          const body: Record<string, unknown> = {
            query: effectiveQuery,
            top_k: candidateTopK,
            rerank,
            ...scopeCandidate,
            ...extraBody
          }
          if (fields) body.fields = fields

          try {
            const response = await mem0ApiRequest.call(this, 'POST', '/search', body)
            scopedResults = extractResults(response)
            if (scopedResults.length > 0) break
          } catch (error) {
            hadSearchError = true
            lastSearchError = error
          }
        }
        return scopedResults
      }

      if (searchFilters && Object.keys(searchFilters).length > 0) {
        results = await runScopedSearch({ filters: searchFilters })

        if (results.length === 0 && !allowEmptyContext) {
          results = await runScopedSearch()
        }
      } else {
        results = await runScopedSearch()
      }

      if (results.length === 0 && hadSearchError) {
        const errorMessage = lastSearchError instanceof Error ? lastSearchError.message : String(lastSearchError ?? 'Unknown error')
        throw new NodeOperationError(
          this.getNode(),
          `Mem0 search failed for all scope candidates. Last error: ${errorMessage}`
        )
      }

      let filtered = results
      if (searchMode === 'strict_facts') {
        filtered = results.filter((entry: any) => {
          const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase()
          const memoryType = String(entry?.metadata?.memory_type || '').toLowerCase()
          return role === 'user' || role === 'human' || memoryType === 'fact'
        })
      } else if (searchMode === 'balanced') {
        filtered = results.filter((entry: any) => {
          const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase()
          return role === 'user' || role === 'human'
        })
      }

      const roleApplied = filtered.length > 0 ? filtered : results

      const assistantFiltered =
        searchMode === 'legacy'
          ? roleApplied.filter((entry: any) => {
              const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase()
              return role === 'user' || role === 'human' || role === 'assistant' || role === 'ai'
            })
          : includeAssistantMemories
            ? roleApplied
            : roleApplied.filter((entry: any) => {
                const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase()
                return role === 'user' || role === 'human'
              })

      const contentSanitized = assistantFiltered.filter((entry: any) => {
        const text = toMessageContent(entry).trim()
        if (!text) return false
        if (text.includes('$input.first().json')) return false
        const normalize = (v: string): string => v.toLowerCase().replace(/\s+/g, ' ').trim()
        const queryComparable = normalize(extractedQuery)
        if (queryComparable && normalize(text) === queryComparable) return false
        return true
      })

      const sanitized = contentSanitized.length > 0 ? contentSanitized : assistantFiltered

      const dedupMap = new Map<string, { entry: any; index: number; ts: number }>()
      sanitized.forEach((entry: any, index: number) => {
        const key = toMessageContent(entry).trim().toLowerCase()
        const ts = new Date(entry?.created_at || entry?.updated_at || 0).getTime() || 0
        const prev = dedupMap.get(key)
        if (!prev || ts > prev.ts) {
          dedupMap.set(key, { entry, index, ts })
        }
      })

      const hasInterrogativeMark = (text: string): boolean => /\?\s*$/.test(text.trim())
      const scored = [...dedupMap.values()].map((item) => {
        const text = toMessageContent(item.entry).trim()
        let score = 0
        if (hasInterrogativeMark(text)) score -= 4
        return { ...item, score }
      })

      const ordered = scored.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score
        if (a.index !== b.index) return a.index - b.index
        return b.ts - a.ts
      })

      const topKEntries = ordered.slice(0, topK).map((x) => x.entry)

      let charBudget = maxContextChars
      const finalResults: any[] = []
      for (const entry of topKEntries) {
        const content = toMessageContent(entry)
        if (!content) continue
        const nextCost = content.length
        if (finalResults.length > 0 && nextCost > charBudget) continue
        if (nextCost > charBudget && finalResults.length === 0) {
          finalResults.push({
            ...entry,
            memory: content.slice(0, charBudget)
          })
          charBudget = 0
          break
        }
        finalResults.push(entry)
        charBudget -= nextCost
        if (charBudget <= 0) break
      }

      if (!allowEmptyContext && finalResults.length === 0 && results.length > 0) {
        finalResults.push(results[0])
      }

      const messages = finalResults.map((entry: any) => toLangchainMessage(entry))
      if (debugMemory && messages.length > 0) {
        ;(messages[0] as any).additional_kwargs = {
          ...((messages[0] as any).additional_kwargs || {}),
          mem0_debug: {
            source: 'semantic_search',
            query: effectiveQuery,
            results: finalResults.length
          }
        }
      }
      return messages
    }

    const resolveConversationMessages = async (values: any, retrieveFn: (inputValues: any) => Promise<any[]>): Promise<any[]> => {
      const bufferMessages = await loadConversationMessages()

      if (conversationRetrievalPolicy === 'buffer_first') {
        return bufferMessages
      }

      if (conversationRetrievalPolicy === 'search_first') {
        const searchResults = await retrieveFn(values)
        if (searchResults.length > 0) return searchResults
        return bufferMessages
      }
      if (!fallbackToSearchOnBufferMiss) return bufferMessages
      // Smart fallback: always try semantic retrieval first; if empty, keep buffer.
      // This is language-agnostic and ensures AI Agent receives Mem0 /search context.
      const searchResults = await retrieveFn(values)
      if (searchResults.length === 0) return bufferMessages

      // Keep a tiny conversational tail for continuity while prioritizing semantic facts.
      const tailSize = Math.min(2, bufferMessages.length)
      const recentTail = tailSize > 0 ? bufferMessages.slice(-tailSize) : []
      return [...recentTail, ...searchResults]
    }

    const memory = BufferWindowMemory
      ? (() => {
          class HybridBufferMemory extends BufferWindowMemory {
            private readonly retrieveFn: (values: any) => Promise<any[]>

            constructor(fields: any, retrieveFn: (values: any) => Promise<any[]>) {
              super(fields)
              this.retrieveFn = retrieveFn
            }

            async loadMemoryVariables(values: any): Promise<Record<string, any>> {
              const messages =
                memoryMode === 'conversation_pairs'
                  ? await resolveConversationMessages(values, this.retrieveFn)
                  : await this.retrieveFn(values)
              return { [this.memoryKey]: messages }
            }

            async saveContext(inputValues: any, outputValues: any): Promise<void> {
              if (typeof super.saveContext === 'function') {
                await super.saveContext(inputValues, outputValues)
              }
              appendRecentMessagesToCache(inputValues, outputValues)
            }
          }

          return new HybridBufferMemory(
            {
              memoryKey: 'chat_history',
              chatHistory,
              returnMessages: true,
              inputKey: 'input',
              outputKey: 'output',
              k: Math.max(topK, bufferLimit * 2)
            },
            searchMessages
          )
        })()
      : {
          memoryKey: 'chat_history',
          chatHistory,
          returnMessages: true,
          inputKey: 'input',
          outputKey: 'output',
          async loadMemoryVariables(values: any) {
            const messages =
              memoryMode === 'conversation_pairs'
                ? await resolveConversationMessages(values, searchMessages)
                : await searchMessages(values)
            return { chat_history: messages }
          },
          async saveContext(inputValues: any, outputValues: any) {
            const userInput = String(inputValues?.input || inputValues?.query || inputValues?.human_input || inputValues?.chatInput || '').trim()
            const assistantOutput = String(outputValues?.output || outputValues?.response || outputValues?.text || '').trim()
            if (userInput) await chatHistory.addUserMessage(userInput)
            if (assistantOutput) await chatHistory.addAIMessage(assistantOutput)
            appendRecentMessagesToCache(inputValues, outputValues)
          },
          async clear() {
            return
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
    return [
      items.map(() => ({
        json: {
          message: 'Mem0 Chat Memory is ready. Connect "ai_memory" to AI Agent memory input.'
        }
      }))
    ]
  }
}

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

class Mem0ChatHistory {
  private readonly maxMessageLength: number
  private readonly inferOnStore: boolean
  private readonly storeStrategy: 'conversation' | 'facts_only'

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
        source: 'n8n_mem0_memory_search_first',
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
        default: 10,
        typeOptions: { minValue: 1, maxValue: 50 },
        description: 'Maximum number of relevant memories to retrieve per query'
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
          }
        ],
        description: 'Retrieval strategy for search results filtering'
      },
      {
        displayName: 'Max Context Characters',
        name: 'maxContextChars',
        type: 'number',
        default: 700,
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
    const topK = Math.min(50, Math.max(1, Math.floor(Number(this.getNodeParameter('topK', itemIndex, 10) || 10))))
    const searchQuery = String(this.getNodeParameter('searchQuery', itemIndex, '') || '').trim()
    const defaultQuery = String(this.getNodeParameter('defaultQuery', itemIndex, FALLBACK_QUERY) || FALLBACK_QUERY).trim()
    const rerank = Boolean(this.getNodeParameter('rerank', itemIndex, false))
    const searchMode = String(this.getNodeParameter('searchMode', itemIndex, 'balanced') || 'balanced') as 'balanced' | 'strict_facts' | 'all'
    const maxContextChars = Math.max(100, Math.floor(Number(this.getNodeParameter('maxContextChars', itemIndex, 700) || 700)))
    const includeAssistantMemories = Boolean(this.getNodeParameter('includeAssistantMemories', itemIndex, false))
    const storeStrategy = String(this.getNodeParameter('storeStrategy', itemIndex, 'conversation') || 'conversation') as 'conversation' | 'facts_only'
    const fieldsInput = String(this.getNodeParameter('fields', itemIndex, '') || '').trim()
    const searchFiltersInput = String(this.getNodeParameter('searchFilters', itemIndex, '') || '').trim()
    const allowEmptyContext = Boolean(this.getNodeParameter('allowEmptyContext', itemIndex, false))
    const inferOnStore = Boolean(this.getNodeParameter('infer', itemIndex, false))

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

    const searchMessages = async (values: any): Promise<any[]> => {
      let effectiveQuery = searchQuery || ''
      
      if (!effectiveQuery) {
        effectiveQuery = String(
          values?.input || 
          values?.query || 
          values?.human_input || 
          values?.chatInput || 
          values?.text || 
          values?.message || 
          ''
        ).trim()
      }

      if (!effectiveQuery) {
        effectiveQuery = defaultQuery || FALLBACK_QUERY
      }

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

      if (searchFilters && Object.keys(searchFilters).length > 0) {
        for (const scopeCandidate of scopeCandidates) {
          const body: Record<string, unknown> = {
            query: effectiveQuery,
            top_k: topK,
            rerank,
            ...scopeCandidate,
            filters: searchFilters
          }
          if (fields) body.fields = fields

          try {
            const response = await mem0ApiRequest.call(this, 'POST', '/search', body)
            results = extractResults(response)
            if (results.length > 0) break
          } catch {
            // continue
          }
        }

        if (results.length === 0 && !allowEmptyContext) {
          for (const scopeCandidate of scopeCandidates) {
            const body: Record<string, unknown> = {
              query: effectiveQuery,
              top_k: topK,
              rerank,
              ...scopeCandidate
            }
            if (fields) body.fields = fields

            try {
              const response = await mem0ApiRequest.call(this, 'POST', '/search', body)
              results = extractResults(response)
              if (results.length > 0) break
            } catch {
              // continue
            }
          }
        }
      } else {
        for (const scopeCandidate of scopeCandidates) {
          const body: Record<string, unknown> = {
            query: effectiveQuery,
            top_k: topK,
            rerank,
            ...scopeCandidate
          }
          if (fields) body.fields = fields

          try {
            const response = await mem0ApiRequest.call(this, 'POST', '/search', body)
            results = extractResults(response)
            if (results.length > 0) break
          } catch {
            // continue
          }
        }
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

      const assistantFiltered = includeAssistantMemories ? roleApplied : 
        roleApplied.filter((entry: any) => {
          const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase()
          return role === 'user' || role === 'human' || role === 'assistant' || role === 'ai'
        })

      const contentSanitized = assistantFiltered.filter((entry: any) => {
        const text = toMessageContent(entry).trim()
        if (!text) return false
        if (text.includes('$input.first().json')) return false
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

      const ordered = [...dedupMap.values()].sort((a, b) => {
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

      return finalResults.map((entry: any) => toLangchainMessage(entry))
    }

    const memory = BufferWindowMemory
      ? (() => {
          class SearchFirstBufferMemory extends BufferWindowMemory {
            private readonly retrieveFn: (values: any) => Promise<any[]>

            constructor(fields: any, retrieveFn: (values: any) => Promise<any[]>) {
              super(fields)
              this.retrieveFn = retrieveFn
            }

            async loadMemoryVariables(values: any): Promise<Record<string, any>> {
              const messages = await this.retrieveFn(values)
              return { [this.memoryKey]: messages }
            }
          }

          return new SearchFirstBufferMemory(
            {
              memoryKey: 'chat_history',
              chatHistory,
              returnMessages: true,
              inputKey: 'input',
              outputKey: 'output',
              k: topK
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
            const messages = await searchMessages(values)
            return { chat_history: messages }
          },
          async saveContext(inputValues: any, outputValues: any) {
            const userInput = String(inputValues?.input || inputValues?.query || inputValues?.human_input || inputValues?.chatInput || '').trim()
            const assistantOutput = String(outputValues?.output || outputValues?.response || outputValues?.text || '').trim()
            if (userInput) await chatHistory.addUserMessage(userInput)
            if (assistantOutput) await chatHistory.addAIMessage(assistantOutput)
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

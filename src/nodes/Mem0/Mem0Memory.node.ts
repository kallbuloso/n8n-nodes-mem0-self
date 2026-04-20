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

  if (role === 'assistant' || role === 'ai') return createMsg(AIMessage)
  if (role === 'user' || role === 'human') return createMsg(HumanMessage)
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
  app_id?: string
}

class Mem0ConversationStore {
  private readonly maxMessageLength: number
  private readonly inferOnStore: boolean

  constructor(
    private readonly ctx: ISupplyDataFunctions,
    private readonly scope: Mem0Scope,
    options: { maxMessageLength: number; inferOnStore: boolean }
  ) {
    this.maxMessageLength = options.maxMessageLength
    this.inferOnStore = options.inferOnStore
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

  private normalizeRole(message: any): 'user' | 'assistant' {
    const role = String(message?.role || message?.type || message?._getType?.() || '').toLowerCase()
    if (role === 'assistant' || role === 'ai') return 'assistant'
    return 'user'
  }

  private normalizeContent(message: any): string {
    if (typeof message === 'string') return message
    return String(message?.content ?? '')
  }

  private buildMetadata(memoryType: string): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      source: 'n8n_mem0_memory_conversational',
      channel: 'chat',
      memory_type: memoryType
    }
    if (this.scope.app_id) metadata.app_id = this.scope.app_id
    return metadata
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
      infer: this.inferOnStore,
      metadata: this.buildMetadata('conversation'),
      ...this.scope
    })
  }

  async addMessage(message: any): Promise<void> {
    const role = this.normalizeRole(message)
    const content = this.normalizeContent(message)
    const normalized = this.normalize(role, content)
    if (!normalized) return
    await mem0ApiRequest.call(this.ctx, 'POST', '/memories', {
      messages: [{ role, content: normalized }],
      infer: this.inferOnStore,
      metadata: this.buildMetadata('conversation'),
      ...this.scope
    })
  }

  async addMessages(messages: any[]): Promise<void> {
    for (const message of messages || []) {
      await this.addMessage(message)
    }
  }

  async addUserMessage(message: string): Promise<void> {
    const normalized = this.normalize('user', message)
    if (!normalized) return
    await mem0ApiRequest.call(this.ctx, 'POST', '/memories', {
      messages: [{ role: 'user', content: normalized }],
      infer: this.inferOnStore,
      metadata: this.buildMetadata('conversation'),
      ...this.scope
    })
  }

  async addAIMessage(message: string): Promise<void> {
    const normalized = this.normalize('assistant', message)
    if (!normalized) return
    await mem0ApiRequest.call(this.ctx, 'POST', '/memories', {
      messages: [{ role: 'assistant', content: normalized }],
      infer: this.inferOnStore,
      metadata: this.buildMetadata('conversation'),
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

export class Mem0Memory implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Mem0 Chat Memory',
    name: 'mem0Memory',
    icon: 'file:mem0.svg',
    group: ['transform'],
    version: 1,
    description: 'Minimal conversational memory using Mem0 Self-Hosted REST API (POST /search + POST /memories)',
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
        description: 'Required user identifier for memory scope'
      },
      {
        displayName: 'Agent ID',
        name: 'agentId',
        type: 'string',
        default: '',
        required: true,
        description: 'Required agent identifier for memory scope'
      },
      {
        displayName: 'Run ID',
        name: 'runId',
        type: 'string',
        default: '',
        description: 'Optional conversation/session identifier'
      },
      {
        displayName: 'App ID',
        name: 'appId',
        type: 'string',
        default: '',
        description: 'Optional application identifier for memory segmentation'
      },
      {
        displayName: 'Top K',
        name: 'topK',
        type: 'number',
        default: 6,
        typeOptions: { minValue: 1, maxValue: 100 },
        description: 'Number of memory items requested from POST /search'
      },
      {
        displayName: 'Context Window Length',
        name: 'contextWindowLength',
        type: 'number',
        default: 10,
        typeOptions: { minValue: 1, maxValue: 200 },
        description: 'How many past interactions (user+assistant pairs) are returned to chat_history'
      },
      {
        displayName: 'Search Query (Optional)',
        name: 'searchQuery',
        type: 'string',
        default: '',
        description: 'Fixed retrieval query. If empty, uses current user input'
      },
      {
        displayName: 'Default Query',
        name: 'defaultQuery',
        type: 'string',
        default: 'user profile, preferences, and important facts',
        description: 'Fallback query when no user input is available'
      },
      {
        displayName: 'Rerank',
        name: 'rerank',
        type: 'boolean',
        default: false,
        description: 'Enable reranking in Mem0 search'
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
        displayName: 'Infer on Store',
        name: 'infer',
        type: 'boolean',
        default: false,
        description: 'Legacy compatibility toggle'
      },
      {
        displayName: 'Debug Memory Retrieval',
        name: 'debugMemory',
        type: 'boolean',
        default: false,
        description: 'Adds retrieval diagnostics metadata to first returned memory message'
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
    const appId = String(this.getNodeParameter('appId', itemIndex, '') || '').trim()
    const topK = Math.min(100, Math.max(1, Math.floor(Number(this.getNodeParameter('topK', itemIndex, 6) || 6))))
    const contextWindowLength = Math.min(
      200,
      Math.max(1, Math.floor(Number(this.getNodeParameter('contextWindowLength', itemIndex, 10) || 10))
    ))
    const searchQuery = String(this.getNodeParameter('searchQuery', itemIndex, '') || '').trim()
    const defaultQuery = String(this.getNodeParameter('defaultQuery', itemIndex, FALLBACK_QUERY) || FALLBACK_QUERY).trim()
    const rerank = Boolean(this.getNodeParameter('rerank', itemIndex, false))
    const fieldsInput = String(this.getNodeParameter('fields', itemIndex, '') || '').trim()
    const searchFiltersInput = String(this.getNodeParameter('searchFilters', itemIndex, '') || '').trim()
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
    if (appId) scope.app_id = appId

    const conversationStore = new Mem0ConversationStore(this, scope, {
      maxMessageLength: MAX_MESSAGE_LENGTH,
      inferOnStore
    })

    const fields = fieldsInput
      ? fieldsInput
          .split(',')
          .map((field) => field.trim())
          .filter((field) => field.length > 0)
      : undefined

    let searchFilters: Record<string, unknown> | undefined
    if (searchFiltersInput) {
      try {
        const parsedFilters = JSON.parse(searchFiltersInput)
        if (parsedFilters && typeof parsedFilters === 'object' && !Array.isArray(parsedFilters)) {
          searchFilters = parsedFilters as Record<string, unknown>
        } else {
          throw new Error('Filters must be a JSON object')
        }
      } catch {
        throw new NodeOperationError(this.getNode(), 'Search Filters (JSON) is not valid JSON.')
      }
    }

    const searchMessages = async (values: any): Promise<any[]> => {
      const extractedQuery = String(
        searchQuery || values?.input || values?.query || values?.human_input || values?.chatInput || values?.text || values?.message || ''
      ).trim()
      const effectiveQuery = extractedQuery || defaultQuery || FALLBACK_QUERY

      if (effectiveQuery.length > MAX_QUERY_LENGTH) {
        throw new NodeOperationError(
          this.getNode(),
          `Search query is too long. Maximum supported length is ${MAX_QUERY_LENGTH} characters.`
        )
      }

      const executeSearch = async (query: string): Promise<any[]> => {
        const body: Record<string, unknown> = {
          query,
          top_k: topK,
          rerank,
          ...scope
        }
        if (fields && fields.length > 0) body.fields = fields

        const effectiveFilters: Record<string, unknown> = { ...(searchFilters || {}) }
        if (scope.app_id && effectiveFilters.app_id === undefined) {
          effectiveFilters.app_id = scope.app_id
        }
        if (Object.keys(effectiveFilters).length > 0) body.filters = effectiveFilters

        const response = await mem0ApiRequest.call(this, 'POST', '/search', body)
        return extractResults(response)
      }

      let usedQuery = effectiveQuery
      let results = await executeSearch(usedQuery)
      let fallbackUsed = false

      // If current input query yields no context, fall back to default profile query.
      if (results.length === 0 && extractedQuery && defaultQuery && defaultQuery !== effectiveQuery) {
        fallbackUsed = true
        usedQuery = defaultQuery
        results = await executeSearch(usedQuery)
      }

      const maxMessages = contextWindowLength * 2
      const limitedEntries = results
        .map((entry: any) => ({
          entry,
          role: String(entry?.metadata?.role || entry?.role || '').toLowerCase(),
          text: toMessageContent(entry).trim()
        }))
        .filter((x: any) => x.text.length > 0)
        .filter((x: any) => x.role === 'user' || x.role === 'human' || x.role === 'assistant' || x.role === 'ai')
        .slice(0, maxMessages)

      const messages = limitedEntries.map((x: any) => toLangchainMessage(x.entry))

      if (debugMemory && messages.length > 0) {
        ;(messages[0] as any).additional_kwargs = {
          ...((messages[0] as any).additional_kwargs || {}),
          mem0_debug: {
            source: 'search_only_minimal',
            query: usedQuery,
            fallbackUsed,
            results: results.length,
            returnedMessages: messages.length,
            contextWindowLength,
            scope
          }
        }
      }

      return messages
    }

    const memory = {
      memoryKey: 'chat_history',
      returnMessages: true,
      inputKey: 'input',
      outputKey: 'output',
      chatHistory: conversationStore,
      async loadMemoryVariables(values: any) {
        const messages = await searchMessages(values)
        const key = String((this as any).memoryKey || 'chat_history')
        return {
          [key]: messages
        }
      },
      async saveContext(inputValues: any, outputValues: any) {
        const userInput = String(inputValues?.input || inputValues?.query || inputValues?.human_input || inputValues?.chatInput || '').trim()
        const assistantOutput = String(outputValues?.output || outputValues?.response || outputValues?.text || '').trim()
        await conversationStore.addConversationTurn(userInput, assistantOutput)
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

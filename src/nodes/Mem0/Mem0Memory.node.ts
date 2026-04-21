import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription, ISupplyDataFunctions, SupplyData } from 'n8n-workflow'
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow'
import { extractResults, mem0ApiRequest } from './GenericFunctions'

declare const require: any

let HumanMessage: any
let AIMessage: any
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
  }

  const memoryCandidates = ['@langchain/classic/memory', 'langchain/memory']
  for (const moduleName of memoryCandidates) {
    try {
      const loaded = require(moduleName)
      if (loaded?.BufferWindowMemory) {
        BufferWindowMemory = loaded.BufferWindowMemory
        break
      }
    } catch {
      // continue
    }
  }

  try {
    const aiUtils = require('@n8n/ai-utilities')
    logWrapper = aiUtils.logWrapper
  } catch {
    logWrapper = null
  }
})()

type Mem0Scope = {
  user_id: string
  agent_id: string
  run_id?: string
  app_id?: string
}

type Role = 'user' | 'assistant'

type ParsedMemory = {
  role: Role
  content: string
  createdAt: number
}

function normalizeRole(value: any): Role | null {
  const role = String(value || '').toLowerCase()
  if (role === 'user' || role === 'human') return 'user'
  if (role === 'assistant' || role === 'ai') return 'assistant'
  return null
}

function resolveMemoryRole(memory: Record<string, any>): Role | null {
  return (
    normalizeRole(memory.role) ||
    normalizeRole(memory.metadata?.role) ||
    normalizeRole(memory.additional_kwargs?.role) ||
    null
  )
}

function resolveMemoryContent(memory: Record<string, any>): string {
  return String(memory.memory ?? memory.text ?? memory.content ?? '').trim()
}

function resolveCreatedAt(memory: Record<string, any>, index: number): number {
  const value = memory.created_at ?? memory.createdAt ?? memory.updated_at ?? memory.updatedAt ?? memory.timestamp ?? memory.time
  const time = value ? new Date(value).getTime() : Number.NaN
  return Number.isFinite(time) ? time : index
}

function wrapMemoryResponse(memory: any, ctx: ISupplyDataFunctions): any {
  if (typeof logWrapper === 'function') {
    return logWrapper(memory, ctx)
  }
  return memory
}

class Mem0ChatHistory {
  private readonly maxMessageLength: number
  private readonly maxMessages: number

  constructor(
    private readonly ctx: ISupplyDataFunctions,
    private readonly scope: Mem0Scope,
    contextWindowLength: number
  ) {
    this.maxMessageLength = 10000
    this.maxMessages = Math.max(1, contextWindowLength) * 2
  }

  private normalizeContent(role: Role, content: string): string {
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

  private async storeMessage(role: Role, content: string): Promise<void> {
    const normalized = this.normalizeContent(role, content)
    if (!normalized) return

    await mem0ApiRequest.call(this.ctx, 'POST', '/memories', {
      messages: [{ role, content: normalized }],
      infer: false,
      metadata: {
        source: 'n8n_mem0_chat_memory',
        channel: 'chat',
        role
      },
      ...this.scope
    })
  }

  async addUserMessage(message: string): Promise<void> {
    await this.storeMessage('user', message)
  }

  async addAIMessage(message: string): Promise<void> {
    await this.storeMessage('assistant', message)
  }

  async addAIChatMessage(message: string): Promise<void> {
    await this.addAIMessage(message)
  }

  async addMessage(message: any): Promise<void> {
    const role = normalizeRole(message?.role || message?.type || message?._getType?.())
    const content = String(message?.content ?? '')
    if (role === 'assistant') {
      await this.addAIMessage(content)
      return
    }
    await this.addUserMessage(content)
  }

  async addMessages(messages: any[]): Promise<void> {
    for (const message of messages || []) {
      await this.addMessage(message)
    }
  }

  async getMessages(): Promise<any[]> {
    const response = await mem0ApiRequest.call(this.ctx, 'GET', '/memories', {}, this.scope)
    const memories = extractResults(response)

    const parsed = memories
      .map((memory: any, index: number): ParsedMemory | null => {
        const role = resolveMemoryRole(memory)
        const content = resolveMemoryContent(memory)
        if (!role || !content) return null
        return {
          role,
          content,
          createdAt: resolveCreatedAt(memory, index)
        }
      })
      .filter((entry: ParsedMemory | null): entry is ParsedMemory => entry !== null)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-this.maxMessages)

    return parsed.map((entry) => (entry.role === 'assistant' ? new AIMessage(entry.content) : new HumanMessage(entry.content)))
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
    description: 'Stores chat history in Mem0 Self-Hosted (conversation buffer mode)',
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
        displayName: 'Context Window Length',
        name: 'contextWindowLength',
        type: 'number',
        default: 20,
        typeOptions: { minValue: 1, maxValue: 200 },
        description: 'How many interactions (human + ai pairs) to keep in chat_history context'
      }
    ]
  }

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    if (!BufferWindowMemory) {
      throw new NodeOperationError(this.getNode(), 'BufferWindowMemory dependency is not available in runtime.')
    }

    const userId = String(this.getNodeParameter('userId', itemIndex, '') || '').trim()
    const agentId = String(this.getNodeParameter('agentId', itemIndex, '') || '').trim()
    const runId = String(this.getNodeParameter('runId', itemIndex, '') || '').trim()
    const appId = String(this.getNodeParameter('appId', itemIndex, '') || '').trim()
    const contextWindowLength = Math.min(
      200,
      Math.max(1, Math.floor(Number(this.getNodeParameter('contextWindowLength', itemIndex, 20) || 20))
    ))

    if (!userId || !agentId) {
      throw new NodeOperationError(this.getNode(), 'User ID and Agent ID are required.')
    }

    const scope: Mem0Scope = {
      user_id: userId,
      agent_id: agentId
    }
    if (runId) scope.run_id = runId
    if (appId) scope.app_id = appId

    const chatHistory = new Mem0ChatHistory(this, scope, contextWindowLength)

    const memory = new BufferWindowMemory({
      memoryKey: 'chat_history',
      chatHistory,
      returnMessages: true,
      inputKey: 'input',
      outputKey: 'output',
      k: contextWindowLength
    })

    return {
      response: wrapMemoryResponse(memory, this)
    }
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

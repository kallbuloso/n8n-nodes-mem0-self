"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mem0Memory = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const GenericFunctions_1 = require("./GenericFunctions");
let HumanMessage;
let AIMessage;
let SystemMessage;
let BufferWindowMemory;
let logWrapper;
(function loadDeps() {
    const messageCandidates = ['@langchain/core/messages', 'langchain/messages'];
    for (const moduleName of messageCandidates) {
        try {
            const loaded = require(moduleName);
            if (loaded?.HumanMessage && loaded?.AIMessage) {
                HumanMessage = loaded.HumanMessage;
                AIMessage = loaded.AIMessage;
                SystemMessage = loaded.SystemMessage || loaded.HumanMessage;
                break;
            }
        }
        catch {
            // continue
        }
    }
    if (!HumanMessage || !AIMessage) {
        class BaseMessage {
            constructor(content) {
                this.lc_namespace = ['langchain_core', 'messages'];
                this.lc_serializable = true;
                this.additional_kwargs = {};
                this.content = content;
            }
        }
        HumanMessage = class extends BaseMessage {
            _getType() {
                return 'human';
            }
            get type() {
                return 'human';
            }
        };
        AIMessage = class extends BaseMessage {
            _getType() {
                return 'ai';
            }
            get type() {
                return 'ai';
            }
        };
        SystemMessage = class extends BaseMessage {
            _getType() {
                return 'system';
            }
            get type() {
                return 'system';
            }
        };
    }
    try {
        const memory = require('@langchain/classic/memory');
        BufferWindowMemory = memory.BufferWindowMemory || memory.BufferMemory;
    }
    catch {
        BufferWindowMemory = null;
    }
    try {
        const aiUtils = require('@n8n/ai-utilities');
        logWrapper = aiUtils.logWrapper;
    }
    catch {
        logWrapper = null;
    }
})();
function toMessageContent(memory) {
    return memory?.memory ?? memory?.text ?? memory?.content ?? '';
}
function toLangchainMessage(memory) {
    const content = toMessageContent(memory);
    const role = String(memory?.metadata?.role || memory?.role || '').toLowerCase();
    if (role === 'user' || role === 'human')
        return new HumanMessage(content);
    if (role === 'assistant' || role === 'ai')
        return new AIMessage(content);
    return new SystemMessage(content);
}
function wrapMemoryResponse(memory, ctx) {
    if (typeof logWrapper === 'function') {
        return logWrapper(memory, ctx);
    }
    return memory;
}
class Mem0ChatHistory {
    constructor(ctx, scope, options) {
        this.ctx = ctx;
        this.scope = scope;
        this.maxMessageLength = options.maxMessageLength;
    }
    normalizeRole(message) {
        const role = String(message?.role || message?.type || message?._getType?.() || '').toLowerCase();
        if (role === 'assistant' || role === 'ai')
            return 'assistant';
        return 'user';
    }
    normalizeContent(message) {
        if (typeof message === 'string')
            return message;
        return String(message?.content ?? '');
    }
    async append(role, content) {
        const normalized = String(content || '').trim();
        if (!normalized)
            return;
        if (normalized.length > this.maxMessageLength) {
            throw new n8n_workflow_1.NodeOperationError(this.ctx.getNode(), `${role === 'user' ? 'User' : 'Assistant'} message is too long. Maximum supported length is ${this.maxMessageLength} characters.`);
        }
        await GenericFunctions_1.mem0ApiRequest.call(this.ctx, 'POST', '/memories', {
            messages: [{ role, content: normalized }],
            infer: false,
            metadata: { source: 'n8n_mem0_memory_safe', role },
            ...this.scope,
        });
    }
    async getMessages() {
        // Search-first mode: history retrieval is handled by loadMemoryVariables/query.
        return [];
    }
    async addMessage(message) {
        const role = this.normalizeRole(message);
        const content = this.normalizeContent(message);
        await this.append(role, content);
    }
    async addMessages(messages) {
        for (const message of messages || []) {
            await this.addMessage(message);
        }
    }
    async addUserMessage(message) {
        await this.append('user', message);
    }
    async addAIMessage(message) {
        await this.append('assistant', message);
    }
    async addAIChatMessage(message) {
        await this.append('assistant', message);
    }
    // Safe profile: intentionally non-destructive.
    async clear() {
        return;
    }
}
class Mem0Memory {
    constructor() {
        this.description = {
            displayName: 'Mem0 Chat Memory',
            name: 'mem0Memory',
            icon: 'file:mem0.svg',
            group: ['transform'],
            version: 1,
            description: 'Persistent chat memory for AI Agent using Mem0 Self-Hosted OSS REST API',
            defaults: { name: 'Mem0 Chat Memory' },
            inputs: [],
            outputs: [n8n_workflow_1.NodeConnectionTypes.AiMemory],
            outputNames: ['Memory'],
            credentials: [{ name: 'mem0SelfHostedApi', required: true }],
            properties: [
                {
                    displayName: 'User ID',
                    name: 'userId',
                    type: 'string',
                    default: '',
                    required: true,
                    description: 'Required memory owner user identifier',
                },
                {
                    displayName: 'Agent ID',
                    name: 'agentId',
                    type: 'string',
                    default: '',
                    required: true,
                    description: 'Required memory owner agent identifier',
                },
                {
                    displayName: 'Run ID',
                    name: 'runId',
                    type: 'string',
                    default: '',
                    description: 'Optional conversation/session identifier',
                },
                {
                    displayName: 'Top K',
                    name: 'topK',
                    type: 'number',
                    default: 10,
                    typeOptions: { minValue: 1, maxValue: 50 },
                    description: 'Maximum number of relevant memories to retrieve per query',
                },
                {
                    displayName: 'Default Query',
                    name: 'defaultQuery',
                    type: 'string',
                    default: '',
                    description: 'Fallback search query when no user input is available',
                },
                {
                    displayName: 'Rerank',
                    name: 'rerank',
                    type: 'boolean',
                    default: false,
                    description: 'Enable reranking in Mem0 search',
                },
                {
                    displayName: 'Fields (Comma Separated)',
                    name: 'fields',
                    type: 'string',
                    default: '',
                    description: 'Optional fields list for search response',
                },
                {
                    displayName: 'Include Assistant Memories',
                    name: 'includeAssistantMemories',
                    type: 'boolean',
                    default: false,
                    description: 'Whether assistant messages should be included in retrieved context',
                },
                {
                    displayName: 'Infer on Store',
                    name: 'infer',
                    type: 'boolean',
                    default: false,
                    description: 'Legacy toggle kept for compatibility. Safe profile stores raw chat turns.',
                },
            ],
        };
    }
    async supplyData(itemIndex) {
        const MAX_MESSAGE_LENGTH = 10000;
        const MAX_QUERY_LENGTH = 2000;
        const userId = String(this.getNodeParameter('userId', itemIndex, '') || '').trim();
        const agentId = String(this.getNodeParameter('agentId', itemIndex, '') || '').trim();
        const runId = String(this.getNodeParameter('runId', itemIndex, '') || '').trim();
        const topK = Math.min(50, Math.max(1, Math.floor(Number(this.getNodeParameter('topK', itemIndex, 10) || 10))));
        const defaultQuery = String(this.getNodeParameter('defaultQuery', itemIndex, '') || '').trim();
        const rerank = Boolean(this.getNodeParameter('rerank', itemIndex, false));
        const fieldsInput = String(this.getNodeParameter('fields', itemIndex, '') || '').trim();
        const includeAssistantMemories = Boolean(this.getNodeParameter('includeAssistantMemories', itemIndex, false));
        if (!userId || !agentId) {
            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'User ID and Agent ID are required.');
        }
        const scope = {
            user_id: userId,
            agent_id: agentId,
        };
        if (runId)
            scope.run_id = runId;
        const chatHistory = new Mem0ChatHistory(this, scope, {
            maxMessageLength: MAX_MESSAGE_LENGTH,
        });
        const searchMessages = async (values) => {
            const rawQuery = String(values?.input || values?.query || values?.human_input || values?.chatInput || defaultQuery || '').trim();
            if (!rawQuery)
                return [];
            if (rawQuery.length > MAX_QUERY_LENGTH) {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Search query is too long. Maximum supported length is ${MAX_QUERY_LENGTH} characters.`);
            }
            const body = {
                query: rawQuery,
                top_k: topK,
                rerank,
                ...scope,
            };
            if (fieldsInput) {
                body.fields = fieldsInput
                    .split(',')
                    .map((field) => field.trim())
                    .filter((field) => field.length > 0);
            }
            const response = await GenericFunctions_1.mem0ApiRequest.call(this, 'POST', '/search', body);
            const results = (0, GenericFunctions_1.extractResults)(response);
            const userOnlyOrAll = results.filter((entry) => {
                if (includeAssistantMemories)
                    return true;
                const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase();
                return role === 'user' || role === 'human';
            });
            const contentSanitized = userOnlyOrAll.filter((entry) => {
                const text = toMessageContent(entry).trim();
                if (!text)
                    return false;
                // Drop obvious non-memory placeholders.
                if (text.includes('$input.first().json'))
                    return false;
                // Drop interrogative user utterances that usually pollute semantic recall for factual retrieval.
                if (text.endsWith('?'))
                    return false;
                return true;
            });
            // De-duplicate by normalized content, keeping the newest instance.
            const dedupMap = new Map();
            contentSanitized.forEach((entry, index) => {
                const key = toMessageContent(entry).trim().toLowerCase();
                const ts = new Date(entry?.created_at || entry?.updated_at || 0).getTime() || 0;
                const prev = dedupMap.get(key);
                if (!prev || ts > prev.ts) {
                    dedupMap.set(key, { entry, index, ts });
                }
            });
            // Keep Mem0 search ranking as primary signal; recency only breaks ties.
            const ordered = [...dedupMap.values()].sort((a, b) => {
                if (a.index !== b.index)
                    return a.index - b.index;
                return b.ts - a.ts;
            });
            const finalResults = ordered.slice(0, topK).map((x) => x.entry);
            return finalResults.map((entry) => toLangchainMessage(entry));
        };
        const memory = BufferWindowMemory
            ? (() => {
                class SearchFirstBufferMemory extends BufferWindowMemory {
                    constructor(fields, retrieveFn) {
                        super(fields);
                        this.retrieveFn = retrieveFn;
                    }
                    async loadMemoryVariables(values) {
                        const messages = await this.retrieveFn(values);
                        return { [this.memoryKey]: messages };
                    }
                }
                return new SearchFirstBufferMemory({
                    memoryKey: 'chat_history',
                    chatHistory,
                    returnMessages: true,
                    inputKey: 'input',
                    outputKey: 'output',
                    k: topK,
                }, searchMessages);
            })()
            : {
                memoryKey: 'chat_history',
                chatHistory,
                returnMessages: true,
                inputKey: 'input',
                outputKey: 'output',
                async loadMemoryVariables(values) {
                    return { chat_history: await searchMessages(values) };
                },
                async saveContext(inputValues, outputValues) {
                    const userInput = String(inputValues?.input || inputValues?.query || inputValues?.human_input || inputValues?.chatInput || '').trim();
                    const assistantOutput = String(outputValues?.output || outputValues?.response || outputValues?.text || '').trim();
                    if (userInput)
                        await chatHistory.addUserMessage(userInput);
                    if (assistantOutput)
                        await chatHistory.addAIMessage(assistantOutput);
                },
                async clear() {
                    return;
                },
            };
        return { response: wrapMemoryResponse(memory, this) };
    }
    async execute() {
        const items = this.getInputData();
        return [
            items.map(() => ({
                json: {
                    message: 'Mem0 Chat Memory is ready. Connect "ai_memory" to AI Agent memory input.',
                },
            })),
        ];
    }
}
exports.Mem0Memory = Mem0Memory;
//# sourceMappingURL=Mem0Memory.node.js.map
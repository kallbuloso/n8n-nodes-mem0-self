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
    const createMsg = (MsgClass) => {
        const msg = new MsgClass(content);
        msg.additional_kwargs = memory?.additional_kwargs || {};
        msg.response_metadata = memory?.response_metadata || {};
        return msg;
    };
    if (role === 'user' || role === 'human')
        return createMsg(HumanMessage);
    if (role === 'assistant' || role === 'ai')
        return createMsg(AIMessage);
    return createMsg(SystemMessage);
}
function wrapMemoryResponse(memory, ctx) {
    if (typeof logWrapper === 'function') {
        return logWrapper(memory, ctx);
    }
    return memory;
}
class Mem0ChatHistory {
    static getScopedCacheKey(scope, maxMessages) {
        return `strict|${scope.user_id}|${scope.agent_id}|${scope.run_id || ''}|${maxMessages}`;
    }
    static getGlobalCacheKey(userId, agentId, maxMessages) {
        return `global|${userId}|${agentId}|${maxMessages}`;
    }
    static getConversationCache(key) {
        const entry = this.conversationCache.get(key);
        if (!entry)
            return null;
        if (Date.now() - entry.ts > this.CONVERSATION_CACHE_TTL_MS) {
            this.conversationCache.delete(key);
            return null;
        }
        return entry.entries;
    }
    static setConversationCache(key, entries) {
        this.conversationCache.set(key, {
            ts: Date.now(),
            entries
        });
    }
    static appendToConversationCache(key, incoming, maxMessages) {
        const entry = this.conversationCache.get(key);
        if (!entry || !Array.isArray(entry.entries))
            return;
        const merged = [...entry.entries, ...incoming].slice(-maxMessages);
        this.conversationCache.set(key, {
            ts: Date.now(),
            entries: merged
        });
    }
    constructor(ctx, scope, options) {
        this.ctx = ctx;
        this.scope = scope;
        this.maxMessageLength = options.maxMessageLength;
        this.inferOnStore = options.inferOnStore;
        this.storeStrategy = options.storeStrategy;
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
        if (this.storeStrategy === 'facts_only' && role !== 'user') {
            return;
        }
        const normalized = String(content || '').trim();
        if (!normalized)
            return;
        if (normalized.length > this.maxMessageLength) {
            throw new n8n_workflow_1.NodeOperationError(this.ctx.getNode(), `${role === 'user' ? 'User' : 'Assistant'} message is too long. Maximum supported length is ${this.maxMessageLength} characters.`);
        }
        await GenericFunctions_1.mem0ApiRequest.call(this.ctx, 'POST', '/memories', {
            messages: [{ role, content: normalized }],
            infer: this.inferOnStore,
            metadata: {
                source: 'n8n_mem0_memory_hybrid',
                role,
                channel: 'chat',
                memory_type: this.storeStrategy === 'facts_only' ? 'fact' : 'conversation'
            },
            ...this.scope
        });
    }
    async getMessages() {
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
    async clear() {
        return;
    }
}
Mem0ChatHistory.CONVERSATION_CACHE_TTL_MS = 120000;
Mem0ChatHistory.conversationCache = new Map();
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
        };
    }
    async supplyData(itemIndex) {
        const MAX_MESSAGE_LENGTH = 10000;
        const MAX_QUERY_LENGTH = 2000;
        const FALLBACK_QUERY = 'user profile, preferences, and important facts';
        const userId = String(this.getNodeParameter('userId', itemIndex, '') || '').trim();
        const agentId = String(this.getNodeParameter('agentId', itemIndex, '') || '').trim();
        const runId = String(this.getNodeParameter('runId', itemIndex, '') || '').trim();
        const topK = Math.min(50, Math.max(1, Math.floor(Number(this.getNodeParameter('topK', itemIndex, 3) || 3))));
        const memoryMode = String(this.getNodeParameter('memoryMode', itemIndex, 'conversation_pairs') || 'conversation_pairs');
        const bufferLimit = Math.max(1, Math.floor(Number(this.getNodeParameter('bufferLimit', itemIndex, 6) || 6)));
        const fallbackToSearchOnBufferMiss = Boolean(this.getNodeParameter('fallbackToSearchOnBufferMiss', itemIndex, true));
        const conversationRetrievalPolicy = String(this.getNodeParameter('conversationRetrievalPolicy', itemIndex, 'smart_fallback') || 'smart_fallback');
        const searchQuery = String(this.getNodeParameter('searchQuery', itemIndex, '') || '').trim();
        const defaultQuery = String(this.getNodeParameter('defaultQuery', itemIndex, FALLBACK_QUERY) || FALLBACK_QUERY).trim();
        const rerank = Boolean(this.getNodeParameter('rerank', itemIndex, false));
        const searchMode = String(this.getNodeParameter('searchMode', itemIndex, 'balanced') || 'balanced');
        const maxContextChars = Math.max(100, Math.floor(Number(this.getNodeParameter('maxContextChars', itemIndex, 450) || 450)));
        const includeAssistantMemories = Boolean(this.getNodeParameter('includeAssistantMemories', itemIndex, false));
        const storeStrategy = String(this.getNodeParameter('storeStrategy', itemIndex, 'conversation') || 'conversation');
        const fieldsInput = String(this.getNodeParameter('fields', itemIndex, '') || '').trim();
        const searchFiltersInput = String(this.getNodeParameter('searchFilters', itemIndex, '') || '').trim();
        const allowEmptyContext = Boolean(this.getNodeParameter('allowEmptyContext', itemIndex, false));
        const inferOnStore = Boolean(this.getNodeParameter('infer', itemIndex, false));
        const debugMemory = Boolean(this.getNodeParameter('debugMemory', itemIndex, false));
        if (!userId || !agentId) {
            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'User ID and Agent ID are required.');
        }
        const scope = {
            user_id: userId,
            agent_id: agentId
        };
        if (runId)
            scope.run_id = runId;
        const chatHistory = new Mem0ChatHistory(this, scope, {
            maxMessageLength: MAX_MESSAGE_LENGTH,
            inferOnStore,
            storeStrategy
        });
        const maxMessages = bufferLimit * 2;
        const strictCacheKey = Mem0ChatHistory.getScopedCacheKey(scope, maxMessages);
        const globalCacheKey = Mem0ChatHistory.getGlobalCacheKey(scope.user_id, scope.agent_id, maxMessages);
        const appendRecentMessagesToCache = (inputValues, outputValues) => {
            const userInput = String(inputValues?.input || inputValues?.query || inputValues?.human_input || inputValues?.chatInput || '').trim();
            const assistantOutput = String(outputValues?.output || outputValues?.response || outputValues?.text || '').trim();
            const now = new Date().toISOString();
            const incoming = [];
            if (userInput) {
                incoming.push({
                    memory: userInput,
                    metadata: { role: 'user' },
                    created_at: now
                });
            }
            if (assistantOutput && storeStrategy !== 'facts_only') {
                incoming.push({
                    memory: assistantOutput,
                    metadata: { role: 'assistant' },
                    created_at: now
                });
            }
            if (incoming.length > 0) {
                Mem0ChatHistory.appendToConversationCache(strictCacheKey, incoming, maxMessages);
                Mem0ChatHistory.appendToConversationCache(globalCacheKey, incoming, maxMessages);
            }
        };
        const normalizeConversationEntries = (entries) => {
            return entries
                .filter((entry) => {
                const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase();
                return role === 'user' || role === 'human' || role === 'assistant' || role === 'ai';
            })
                .sort((a, b) => {
                const aTs = new Date(a?.created_at || a?.updated_at || 0).getTime() || 0;
                const bTs = new Date(b?.created_at || b?.updated_at || 0).getTime() || 0;
                return aTs - bTs;
            });
        };
        const loadConversationMessages = async () => {
            const cachedStrict = Mem0ChatHistory.getConversationCache(strictCacheKey);
            if (cachedStrict) {
                return cachedStrict.map((entry) => toLangchainMessage(entry));
            }
            const strictScope = runId
                ? { user_id: scope.user_id, agent_id: scope.agent_id, run_id: scope.run_id }
                : { user_id: scope.user_id, agent_id: scope.agent_id };
            const response = await GenericFunctions_1.mem0ApiRequest.call(this, 'GET', '/memories', {}, strictScope);
            const strictResults = (0, GenericFunctions_1.extractResults)(response);
            const strictNormalized = normalizeConversationEntries(strictResults);
            let selected = strictNormalized.slice(-maxMessages);
            // Continuity support: if current run has little history, pull a small tail from previous runs.
            if (runId && selected.length < maxMessages) {
                let globalNormalized = Mem0ChatHistory.getConversationCache(globalCacheKey);
                if (!globalNormalized) {
                    const globalResponse = await GenericFunctions_1.mem0ApiRequest.call(this, 'GET', '/memories', {}, {
                        user_id: scope.user_id,
                        agent_id: scope.agent_id
                    });
                    const globalResults = (0, GenericFunctions_1.extractResults)(globalResponse);
                    globalNormalized = normalizeConversationEntries(globalResults);
                    Mem0ChatHistory.setConversationCache(globalCacheKey, globalNormalized);
                }
                const strictIdentity = new Set(strictNormalized.map((entry) => String(entry?.id || `${entry?.created_at || ''}|${entry?.metadata?.role || entry?.role || ''}|${toMessageContent(entry)}`)));
                const previousOnly = globalNormalized.filter((entry) => {
                    const key = String(entry?.id || `${entry?.created_at || ''}|${entry?.metadata?.role || entry?.role || ''}|${toMessageContent(entry)}`);
                    return !strictIdentity.has(key);
                });
                const missing = Math.max(0, maxMessages - selected.length);
                if (missing > 0) {
                    selected = [...previousOnly.slice(-missing), ...selected].slice(-maxMessages);
                }
            }
            Mem0ChatHistory.setConversationCache(strictCacheKey, selected);
            return selected.map((entry) => toLangchainMessage(entry));
        };
        const shouldFallbackToSearch = (values, bufferMessages) => {
            if (!fallbackToSearchOnBufferMiss)
                return false;
            if (bufferMessages.length === 0)
                return true;
            const query = String(values?.input || values?.query || values?.human_input || values?.chatInput || values?.text || values?.message || '')
                .trim()
                .toLowerCase();
            if (!query)
                return false;
            // Identity/profile recall questions should strongly prefer semantic fallback.
            const factualRecallPattern = /(qual.*meu nome|meu nome|what.*my name|my name|quem sou eu|who am i|prefer|prefiro|gosto|where.*live|onde eu moro|location|idade|age)/i;
            if (factualRecallPattern.test(query))
                return true;
            const bufferText = bufferMessages
                .map((m) => String(m?.content || ''))
                .join(' ')
                .toLowerCase();
            const stopwords = new Set([
                'a', 'an', 'and', 'are', 'as', 'at', 'do', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'the',
                'to', 'was', 'what', 'where', 'who', 'com', 'como', 'da', 'de', 'do', 'e', 'ele', 'ela', 'em', 'eu', 'isso', 'meu', 'minha',
                'na', 'no', 'o', 'os', 'para', 'por', 'qual', 'que', 'se', 'uma', 'um', 'yo', 'mi', 'donde', 'el', 'la', 'los', 'las', 'un', 'una'
            ]);
            const tokens = query
                .split(/[^a-z0-9]+/i)
                .map((t) => t.trim())
                .filter((t) => t.length >= 3 && !stopwords.has(t));
            if (tokens.length === 0)
                return false;
            const matchedCount = tokens.filter((t) => bufferText.includes(t)).length;
            const coverage = matchedCount / tokens.length;
            if (matchedCount === 0)
                return true;
            if (tokens.length >= 3 && coverage < 0.6)
                return true;
            if (tokens.length >= 5 && matchedCount < 2)
                return true;
            return false;
        };
        const searchMessages = async (values) => {
            let effectiveQuery = searchQuery || '';
            if (!effectiveQuery) {
                effectiveQuery = String(values?.input ||
                    values?.query ||
                    values?.human_input ||
                    values?.chatInput ||
                    values?.text ||
                    values?.message ||
                    '').trim();
            }
            if (!effectiveQuery) {
                effectiveQuery = defaultQuery || FALLBACK_QUERY;
            }
            if (effectiveQuery.length > MAX_QUERY_LENGTH) {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Search query is too long. Maximum supported length is ${MAX_QUERY_LENGTH} characters.`);
            }
            const fields = fieldsInput
                ? fieldsInput
                    .split(',')
                    .map((field) => field.trim())
                    .filter((field) => field.length > 0)
                : undefined;
            let searchFilters;
            if (searchFiltersInput) {
                try {
                    searchFilters = JSON.parse(searchFiltersInput);
                }
                catch {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Search Filters (JSON) is not valid JSON.');
                }
            }
            const scopeCandidates = [];
            scopeCandidates.push({ ...scope });
            scopeCandidates.push({ user_id: scope.user_id, agent_id: scope.agent_id });
            scopeCandidates.push({ user_id: scope.user_id });
            let results = [];
            let hadSearchError = false;
            let lastSearchError = null;
            const runScopedSearch = async (extraBody = {}) => {
                let scopedResults = [];
                for (const scopeCandidate of scopeCandidates) {
                    const body = {
                        query: effectiveQuery,
                        top_k: topK,
                        rerank,
                        ...scopeCandidate,
                        ...extraBody
                    };
                    if (fields)
                        body.fields = fields;
                    try {
                        const response = await GenericFunctions_1.mem0ApiRequest.call(this, 'POST', '/search', body);
                        scopedResults = (0, GenericFunctions_1.extractResults)(response);
                        if (scopedResults.length > 0)
                            break;
                    }
                    catch (error) {
                        hadSearchError = true;
                        lastSearchError = error;
                    }
                }
                return scopedResults;
            };
            if (searchFilters && Object.keys(searchFilters).length > 0) {
                results = await runScopedSearch({ filters: searchFilters });
                if (results.length === 0 && !allowEmptyContext) {
                    results = await runScopedSearch();
                }
            }
            else {
                results = await runScopedSearch();
            }
            if (results.length === 0 && hadSearchError) {
                const errorMessage = lastSearchError instanceof Error ? lastSearchError.message : String(lastSearchError ?? 'Unknown error');
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Mem0 search failed for all scope candidates. Last error: ${errorMessage}`);
            }
            let filtered = results;
            if (searchMode === 'strict_facts') {
                filtered = results.filter((entry) => {
                    const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase();
                    const memoryType = String(entry?.metadata?.memory_type || '').toLowerCase();
                    return role === 'user' || role === 'human' || memoryType === 'fact';
                });
            }
            else if (searchMode === 'balanced') {
                filtered = results.filter((entry) => {
                    const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase();
                    return role === 'user' || role === 'human';
                });
            }
            const roleApplied = filtered.length > 0 ? filtered : results;
            const assistantFiltered = searchMode === 'legacy'
                ? roleApplied.filter((entry) => {
                    const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase();
                    return role === 'user' || role === 'human' || role === 'assistant' || role === 'ai';
                })
                : includeAssistantMemories
                    ? roleApplied
                    : roleApplied.filter((entry) => {
                        const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase();
                        return role === 'user' || role === 'human';
                    });
            const contentSanitized = assistantFiltered.filter((entry) => {
                const text = toMessageContent(entry).trim();
                if (!text)
                    return false;
                if (text.includes('$input.first().json'))
                    return false;
                return true;
            });
            const sanitized = contentSanitized.length > 0 ? contentSanitized : assistantFiltered;
            const dedupMap = new Map();
            sanitized.forEach((entry, index) => {
                const key = toMessageContent(entry).trim().toLowerCase();
                const ts = new Date(entry?.created_at || entry?.updated_at || 0).getTime() || 0;
                const prev = dedupMap.get(key);
                if (!prev || ts > prev.ts) {
                    dedupMap.set(key, { entry, index, ts });
                }
            });
            const ordered = [...dedupMap.values()].sort((a, b) => {
                if (a.index !== b.index)
                    return a.index - b.index;
                return b.ts - a.ts;
            });
            const topKEntries = ordered.slice(0, topK).map((x) => x.entry);
            let charBudget = maxContextChars;
            const finalResults = [];
            for (const entry of topKEntries) {
                const content = toMessageContent(entry);
                if (!content)
                    continue;
                const nextCost = content.length;
                if (finalResults.length > 0 && nextCost > charBudget)
                    continue;
                if (nextCost > charBudget && finalResults.length === 0) {
                    finalResults.push({
                        ...entry,
                        memory: content.slice(0, charBudget)
                    });
                    charBudget = 0;
                    break;
                }
                finalResults.push(entry);
                charBudget -= nextCost;
                if (charBudget <= 0)
                    break;
            }
            if (!allowEmptyContext && finalResults.length === 0 && results.length > 0) {
                finalResults.push(results[0]);
            }
            const messages = finalResults.map((entry) => toLangchainMessage(entry));
            if (debugMemory && messages.length > 0) {
                ;
                messages[0].additional_kwargs = {
                    ...(messages[0].additional_kwargs || {}),
                    mem0_debug: {
                        source: 'semantic_search',
                        query: effectiveQuery,
                        results: finalResults.length
                    }
                };
            }
            return messages;
        };
        const resolveConversationMessages = async (values, retrieveFn) => {
            const bufferMessages = await loadConversationMessages();
            if (conversationRetrievalPolicy === 'buffer_first') {
                return bufferMessages;
            }
            if (conversationRetrievalPolicy === 'search_first') {
                const searchResults = await retrieveFn(values);
                if (searchResults.length > 0)
                    return searchResults;
                return bufferMessages;
            }
            const fallback = shouldFallbackToSearch(values, bufferMessages);
            if (!fallback)
                return bufferMessages;
            const searchResults = await retrieveFn(values);
            if (searchResults.length === 0)
                return bufferMessages;
            // Keep a tiny recent conversational tail so chat_history remains Human+AI contextual.
            const tailSize = Math.min(4, bufferMessages.length);
            const recentTail = tailSize > 0 ? bufferMessages.slice(-tailSize) : [];
            return [...recentTail, ...searchResults];
        };
        const memory = BufferWindowMemory
            ? (() => {
                class HybridBufferMemory extends BufferWindowMemory {
                    constructor(fields, retrieveFn) {
                        super(fields);
                        this.retrieveFn = retrieveFn;
                    }
                    async loadMemoryVariables(values) {
                        const messages = memoryMode === 'conversation_pairs'
                            ? await resolveConversationMessages(values, this.retrieveFn)
                            : await this.retrieveFn(values);
                        return { [this.memoryKey]: messages };
                    }
                    async saveContext(inputValues, outputValues) {
                        if (typeof super.saveContext === 'function') {
                            await super.saveContext(inputValues, outputValues);
                        }
                        appendRecentMessagesToCache(inputValues, outputValues);
                    }
                }
                return new HybridBufferMemory({
                    memoryKey: 'chat_history',
                    chatHistory,
                    returnMessages: true,
                    inputKey: 'input',
                    outputKey: 'output',
                    k: Math.max(topK, bufferLimit * 2)
                }, searchMessages);
            })()
            : {
                memoryKey: 'chat_history',
                chatHistory,
                returnMessages: true,
                inputKey: 'input',
                outputKey: 'output',
                async loadMemoryVariables(values) {
                    const messages = memoryMode === 'conversation_pairs'
                        ? await resolveConversationMessages(values, searchMessages)
                        : await searchMessages(values);
                    return { chat_history: messages };
                },
                async saveContext(inputValues, outputValues) {
                    const userInput = String(inputValues?.input || inputValues?.query || inputValues?.human_input || inputValues?.chatInput || '').trim();
                    const assistantOutput = String(outputValues?.output || outputValues?.response || outputValues?.text || '').trim();
                    if (userInput)
                        await chatHistory.addUserMessage(userInput);
                    if (assistantOutput)
                        await chatHistory.addAIMessage(assistantOutput);
                    appendRecentMessagesToCache(inputValues, outputValues);
                },
                async clear() {
                    return;
                }
            };
        const wrappedMemory = wrapMemoryResponse(memory, this);
        if (wrappedMemory && typeof wrappedMemory === 'object') {
            wrappedMemory.memoryKey = wrappedMemory.memoryKey || 'chat_history';
        }
        return { response: wrappedMemory };
    }
    async execute() {
        const items = this.getInputData();
        return [
            items.map(() => ({
                json: {
                    message: 'Mem0 Chat Memory is ready. Connect "ai_memory" to AI Agent memory input.'
                }
            }))
        ];
    }
}
exports.Mem0Memory = Mem0Memory;
//# sourceMappingURL=Mem0Memory.node.js.map
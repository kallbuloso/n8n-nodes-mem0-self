"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mem0Memory = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const GenericFunctions_1 = require("./GenericFunctions");
let HumanMessage;
let AIMessage;
let SystemMessage;
(function loadLangchainMessages() {
    const candidates = ['@langchain/core/messages', 'langchain/messages'];
    for (const moduleName of candidates) {
        try {
            const loaded = require(moduleName);
            if (loaded?.HumanMessage && loaded?.AIMessage) {
                HumanMessage = loaded.HumanMessage;
                AIMessage = loaded.AIMessage;
                SystemMessage = loaded.SystemMessage || loaded.HumanMessage;
                return;
            }
        }
        catch {
            // Continue trying other candidates
        }
    }
    class BaseMessage {
        constructor(content) {
            this.lc_namespace = ['langchain_core', 'messages'];
            this.lc_serializable = true;
            this.additional_kwargs = {};
            this.content = content;
        }
    }
    HumanMessage = class extends BaseMessage {
        _getType() { return 'human'; }
        get type() { return 'human'; }
    };
    AIMessage = class extends BaseMessage {
        _getType() { return 'ai'; }
        get type() { return 'ai'; }
    };
    SystemMessage = class extends BaseMessage {
        _getType() { return 'system'; }
        get type() { return 'system'; }
    };
})();
function toMessageContent(memory) {
    return memory?.memory ?? memory?.text ?? memory?.content ?? JSON.stringify(memory);
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
class Mem0Memory {
    constructor() {
        this.description = {
            displayName: 'Mem0 Chat Memory',
            name: 'mem0Memory',
            icon: 'file:mem0.svg',
            group: ['transform'],
            version: 1,
            description: 'Safe chat memory for AI Agent using Mem0 Self-Hosted',
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
                    displayName: 'Default Query',
                    name: 'defaultQuery',
                    type: 'string',
                    default: '',
                    description: 'Fallback search query when no dynamic input query is available',
                },
                {
                    displayName: 'Top K',
                    name: 'topK',
                    type: 'number',
                    default: 10,
                    typeOptions: { minValue: 1, maxValue: 50 },
                    description: 'Maximum number of memories retrieved per search',
                },
                {
                    displayName: 'Rerank',
                    name: 'rerank',
                    type: 'boolean',
                    default: false,
                    description: 'Enable reranking during search retrieval',
                },
                {
                    displayName: 'Fields (Comma Separated)',
                    name: 'fields',
                    type: 'string',
                    default: '',
                    description: 'Optional fields list for search response',
                },
                {
                    displayName: 'Infer on Store',
                    name: 'infer',
                    type: 'boolean',
                    default: true,
                    description: 'Enable Mem0 inference when storing memory entries',
                },
            ],
        };
    }
    async supplyData(itemIndex) {
        const MAX_MESSAGE_LENGTH = 10000;
        const MAX_QUERY_LENGTH = 2000;
        const FALLBACK_QUERY = 'recent conversation context for this user and agent';
        const self = this;
        const userId = String(this.getNodeParameter('userId', itemIndex, '') || '').trim();
        const agentId = String(this.getNodeParameter('agentId', itemIndex, '') || '').trim();
        const runId = String(this.getNodeParameter('runId', itemIndex, '') || '').trim();
        const defaultQuery = String(this.getNodeParameter('defaultQuery', itemIndex, '') || '').trim();
        const topK = Math.min(Math.max(1, Math.floor(Number(this.getNodeParameter('topK', itemIndex, 10) || 10))), 50);
        const rerank = Boolean(this.getNodeParameter('rerank', itemIndex, false));
        const fieldsInput = String(this.getNodeParameter('fields', itemIndex, '') || '').trim();
        const infer = Boolean(this.getNodeParameter('infer', itemIndex, true));
        if (!userId || !agentId) {
            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'User ID and Agent ID are required.');
        }
        function buildScope() {
            const scope = {
                user_id: userId,
                agent_id: agentId,
            };
            if (runId)
                scope.run_id = runId;
            return scope;
        }
        async function searchMessages(query) {
            const normalizedQuery = String(query || '').trim();
            const effectiveQuery = normalizedQuery || FALLBACK_QUERY;
            if (effectiveQuery.length > MAX_QUERY_LENGTH) {
                throw new n8n_workflow_1.NodeOperationError(self.getNode(), `Search query is too long. Maximum supported length is ${MAX_QUERY_LENGTH} characters.`);
            }
            const body = {
                query: effectiveQuery,
                top_k: topK,
                rerank,
                ...buildScope(),
            };
            if (fieldsInput) {
                body.fields = fieldsInput
                    .split(',')
                    .map((field) => field.trim())
                    .filter((field) => field.length > 0);
            }
            const response = await GenericFunctions_1.mem0ApiRequest.call(self, 'POST', '/search', body);
            const results = (0, GenericFunctions_1.extractResults)(response);
            return results.map((entry) => toLangchainMessage(entry));
        }
        async function storeMessage(role, content) {
            const normalized = String(content || '').trim();
            if (!normalized)
                return;
            if (normalized.length > MAX_MESSAGE_LENGTH) {
                throw new n8n_workflow_1.NodeOperationError(self.getNode(), `${role === 'user' ? 'User' : 'Assistant'} message is too long. Maximum supported length is ${MAX_MESSAGE_LENGTH} characters.`);
            }
            const body = {
                messages: [{ role, content: normalized }],
                infer,
                metadata: { source: 'n8n_mem0_memory_safe', role },
                ...buildScope(),
            };
            await GenericFunctions_1.mem0ApiRequest.call(self, 'POST', '/memories', body);
        }
        const memoryObject = {
            memoryKeys: ['chat_history'],
            chatHistory: {
                async getMessages() {
                    return searchMessages(defaultQuery);
                },
                async addMessage(message) {
                    const role = String(message?.role || message?.type || '').toLowerCase();
                    const content = String(message?.content ?? '');
                    if (role === 'assistant' || role === 'ai') {
                        await storeMessage('assistant', content);
                        return;
                    }
                    await storeMessage('user', content);
                },
                async addMessages(messages) {
                    for (const message of messages || []) {
                        await this.addMessage(message);
                    }
                },
                async addUserMessage(message) {
                    await storeMessage('user', message);
                },
                async addAIMessage(message) {
                    await storeMessage('assistant', message);
                },
                async addAIChatMessage(message) {
                    await storeMessage('assistant', message);
                },
                // Intentionally non-destructive in safe profile.
                async clear() {
                    return;
                },
            },
            async loadMemoryVariables(values) {
                const query = String(values?.input || values?.query || values?.human_input || values?.chatInput || defaultQuery || '').trim();
                const messages = await searchMessages(query);
                return { chat_history: messages };
            },
            async saveContext(inputValues, outputValues) {
                const userInput = String(inputValues?.input || inputValues?.query || inputValues?.human_input || inputValues?.chatInput || '').trim();
                const assistantOutput = String(outputValues?.output || outputValues?.response || outputValues?.text || '').trim();
                await storeMessage('user', userInput);
                await storeMessage('assistant', assistantOutput);
            },
            // Intentionally non-destructive in safe profile.
            async clear() {
                return;
            },
        };
        return { response: memoryObject };
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
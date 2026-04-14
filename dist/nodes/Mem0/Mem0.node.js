"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mem0 = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const GenericFunctions_1 = require("./GenericFunctions");
class Mem0 {
    constructor() {
        this.description = {
            displayName: 'Mem0 Self-Hosted',
            name: 'mem0SelfHosted',
            icon: 'file:mem0.svg',
            group: ['transform'],
            documentationUrl: 'https://docs.mem0.ai/open-source/features/rest-api',
            version: 1,
            description: 'Safe chat-memory profile for Mem0 Self-Hosted',
            defaults: { name: 'Mem0 Self-Hosted' },
            inputs: ['main'],
            outputs: ['main'],
            credentials: [{ name: 'mem0SelfHostedApi', required: true }],
            properties: [
                {
                    displayName: 'Operation',
                    name: 'operation',
                    type: 'options',
                    noDataExpression: true,
                    options: [
                        {
                            name: 'Store Interaction',
                            value: 'storeInteraction',
                            action: 'Store an interaction',
                            description: 'Store user and assistant messages in a single POST /memories call',
                        },
                        {
                            name: 'Search Conversation Context',
                            value: 'searchConversation',
                            action: 'Search conversation context',
                            description: 'Search memories filtered by user_id and agent_id using POST /search',
                        },
                    ],
                    default: 'storeInteraction',
                },
                {
                    displayName: 'User ID',
                    name: 'userId',
                    type: 'string',
                    default: '',
                    required: true,
                    description: 'User identifier (required)',
                },
                {
                    displayName: 'Agent ID',
                    name: 'agentId',
                    type: 'string',
                    default: '',
                    required: true,
                    description: 'Agent identifier (required)',
                },
                {
                    displayName: 'Run ID',
                    name: 'runId',
                    type: 'string',
                    default: '',
                    required: false,
                    description: 'Optional session identifier',
                },
                {
                    displayName: 'User Message',
                    name: 'userMessage',
                    type: 'string',
                    typeOptions: { rows: 3 },
                    default: '',
                    required: true,
                    displayOptions: { show: { operation: ['storeInteraction'] } },
                    description: 'User message to be stored',
                },
                {
                    displayName: 'Assistant Message',
                    name: 'assistantMessage',
                    type: 'string',
                    typeOptions: { rows: 3 },
                    default: '',
                    required: true,
                    displayOptions: { show: { operation: ['storeInteraction'] } },
                    description: 'Assistant message to be stored',
                },
                {
                    displayName: 'Infer',
                    name: 'infer',
                    type: 'boolean',
                    default: true,
                    displayOptions: { show: { operation: ['storeInteraction'] } },
                    description: 'Enable Mem0 inference while storing',
                },
                {
                    displayName: 'Search Query',
                    name: 'query',
                    type: 'string',
                    default: '',
                    required: true,
                    displayOptions: { show: { operation: ['searchConversation'] } },
                    description: 'Natural-language query for memory search',
                },
                {
                    displayName: 'Top K',
                    name: 'topK',
                    type: 'number',
                    default: 10,
                    typeOptions: { minValue: 1 },
                    displayOptions: { show: { operation: ['searchConversation'] } },
                    description: 'Maximum number of memories to return',
                },
                {
                    displayName: 'Rerank',
                    name: 'rerank',
                    type: 'boolean',
                    default: false,
                    displayOptions: { show: { operation: ['searchConversation'] } },
                    description: 'Enable reranking on search results',
                },
                {
                    displayName: 'Fields (Comma Separated)',
                    name: 'fields',
                    type: 'string',
                    default: '',
                    displayOptions: { show: { operation: ['searchConversation'] } },
                    description: 'Optional list of response fields',
                },
            ],
        };
    }
    async execute() {
        const MAX_MESSAGE_LENGTH = 10000;
        const MAX_QUERY_LENGTH = 2000;
        const MAX_TOP_K = 50;
        const items = this.getInputData();
        const returnData = [];
        const operation = this.getNodeParameter('operation', 0);
        for (let i = 0; i < items.length; i++) {
            try {
                const userId = String(this.getNodeParameter('userId', i, '')).trim();
                const agentId = String(this.getNodeParameter('agentId', i, '')).trim();
                const runId = String(this.getNodeParameter('runId', i, '')).trim();
                if (!userId || !agentId) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'User ID and Agent ID are required for this safe profile.');
                }
                if (operation === 'storeInteraction') {
                    const userMessage = String(this.getNodeParameter('userMessage', i) || '').trim();
                    const assistantMessage = String(this.getNodeParameter('assistantMessage', i) || '').trim();
                    const infer = this.getNodeParameter('infer', i, true);
                    if (!userMessage) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'User Message cannot be empty.');
                    }
                    if (!assistantMessage) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Assistant Message cannot be empty.');
                    }
                    if (userMessage.length > MAX_MESSAGE_LENGTH) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `User Message is too long. Maximum supported length is ${MAX_MESSAGE_LENGTH} characters.`);
                    }
                    if (assistantMessage.length > MAX_MESSAGE_LENGTH) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Assistant Message is too long. Maximum supported length is ${MAX_MESSAGE_LENGTH} characters.`);
                    }
                    const body = {
                        user_id: userId,
                        agent_id: agentId,
                        infer,
                        messages: [
                            { role: 'user', content: userMessage },
                            { role: 'assistant', content: assistantMessage },
                        ],
                        metadata: { source: 'n8n_safe_profile' },
                    };
                    if (runId)
                        body.run_id = runId;
                    const response = await GenericFunctions_1.mem0ApiRequest.call(this, 'POST', '/memories', body);
                    returnData.push({
                        json: {
                            ok: true,
                            operation,
                            user_id: userId,
                            agent_id: agentId,
                            run_id: runId || null,
                            response,
                        },
                    });
                    continue;
                }
                if (operation === 'searchConversation') {
                    const query = String(this.getNodeParameter('query', i) || '').trim();
                    const topKInput = Number(this.getNodeParameter('topK', i, 10));
                    const rerank = Boolean(this.getNodeParameter('rerank', i, false));
                    const fieldsInput = String(this.getNodeParameter('fields', i, '') || '').trim();
                    const topK = Math.min(Math.max(1, Math.floor(topKInput || 10)), MAX_TOP_K);
                    if (!query) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Search Query cannot be empty.');
                    }
                    if (query.length > MAX_QUERY_LENGTH) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Search Query is too long. Maximum supported length is ${MAX_QUERY_LENGTH} characters.`);
                    }
                    const body = {
                        query,
                        user_id: userId,
                        agent_id: agentId,
                        top_k: topK,
                        rerank,
                    };
                    if (runId)
                        body.run_id = runId;
                    if (fieldsInput) {
                        body.fields = fieldsInput
                            .split(',')
                            .map((field) => field.trim())
                            .filter((field) => field.length > 0);
                    }
                    const response = await GenericFunctions_1.mem0ApiRequest.call(this, 'POST', '/search', body);
                    const results = (0, GenericFunctions_1.extractResults)(response);
                    if (results.length === 0) {
                        returnData.push({ json: { ok: true, operation, results: [] } });
                    }
                    else {
                        for (const row of results) {
                            returnData.push({
                                json: {
                                    ok: true,
                                    operation,
                                    user_id: userId,
                                    agent_id: agentId,
                                    run_id: runId || null,
                                    result: row,
                                },
                            });
                        }
                    }
                    continue;
                }
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Unsupported operation: ${operation}`);
            }
            catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({ json: { error: error.message }, pairedItem: { item: i } });
                    continue;
                }
                throw error;
            }
        }
        return [returnData];
    }
}
exports.Mem0 = Mem0;
//# sourceMappingURL=Mem0.node.js.map
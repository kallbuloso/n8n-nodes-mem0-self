import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { extractResults, mem0ApiRequest } from './GenericFunctions';

declare const require: any;

let HumanMessage: any;
let AIMessage: any;
let SystemMessage: any;

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
		} catch {
			// Continue trying other candidates
		}
	}

	class BaseMessage {
		content: string;
		lc_namespace = ['langchain_core', 'messages'];
		lc_serializable = true;
		additional_kwargs = {};

		constructor(content: string) {
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

function toMessageContent(memory: any): string {
	return memory?.memory ?? memory?.text ?? memory?.content ?? JSON.stringify(memory);
}

function toLangchainMessage(memory: any): any {
	const content = toMessageContent(memory);
	const role = String(memory?.metadata?.role || memory?.role || '').toLowerCase();
	if (role === 'user' || role === 'human') return new HumanMessage(content);
	if (role === 'assistant' || role === 'ai') return new AIMessage(content);
	return new SystemMessage(content);
}

export class Mem0Memory implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Mem0 Chat Memory',
		name: 'mem0Memory',
		icon: 'file:mem0.svg',
		group: ['transform'],
		version: 1,
		description: 'Safe chat memory for AI Agent using Mem0 Self-Hosted',
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

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
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
			throw new NodeOperationError(this.getNode(), 'User ID and Agent ID are required.');
		}

		function buildScope() {
			const scope: Record<string, string> = {
				user_id: userId,
				agent_id: agentId,
			};
			if (runId) scope.run_id = runId;
			return scope;
		}

		async function searchMessages(query: string): Promise<any[]> {
			const normalizedQuery = String(query || '').trim();
			const effectiveQuery = normalizedQuery || FALLBACK_QUERY;
			if (effectiveQuery.length > MAX_QUERY_LENGTH) {
				throw new NodeOperationError(
					self.getNode(),
					`Search query is too long. Maximum supported length is ${MAX_QUERY_LENGTH} characters.`,
				);
			}

			const body: Record<string, unknown> = {
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

			const response = await mem0ApiRequest.call(self, 'POST', '/search', body);
			const results = extractResults(response);
			return results.map((entry: any) => toLangchainMessage(entry));
		}

		async function storeMessage(role: 'user' | 'assistant', content: string) {
			const normalized = String(content || '').trim();
			if (!normalized) return;
			if (normalized.length > MAX_MESSAGE_LENGTH) {
				throw new NodeOperationError(
					self.getNode(),
					`${role === 'user' ? 'User' : 'Assistant'} message is too long. Maximum supported length is ${MAX_MESSAGE_LENGTH} characters.`,
				);
			}

			const body: Record<string, unknown> = {
				messages: [{ role, content: normalized }],
				infer,
				metadata: { source: 'n8n_mem0_memory_safe', role },
				...buildScope(),
			};
			await mem0ApiRequest.call(self, 'POST', '/memories', body);
		}

		const memoryObject = {
			memoryKeys: ['chat_history'],
			chatHistory: {
				async getMessages() {
					return searchMessages(defaultQuery);
				},
				async addMessage(message: any) {
					const role = String(message?.role || message?.type || '').toLowerCase();
					const content = String(message?.content ?? '');
					if (role === 'assistant' || role === 'ai') {
						await storeMessage('assistant', content);
						return;
					}
					await storeMessage('user', content);
				},
				async addMessages(messages: any[]) {
					for (const message of messages || []) {
						await this.addMessage(message);
					}
				},
				async addUserMessage(message: string) {
					await storeMessage('user', message);
				},
				async addAIMessage(message: string) {
					await storeMessage('assistant', message);
				},
				async addAIChatMessage(message: string) {
					await storeMessage('assistant', message);
				},
				// Intentionally non-destructive in safe profile.
				async clear() {
					return;
				},
			},
			async loadMemoryVariables(values: any) {
				const query =
					String(values?.input || values?.query || values?.human_input || values?.chatInput || defaultQuery || '').trim();
				const messages = await searchMessages(query);
				return { chat_history: messages };
			},
			async saveContext(inputValues: any, outputValues: any) {
				const userInput = String(
					inputValues?.input || inputValues?.query || inputValues?.human_input || inputValues?.chatInput || '',
				).trim();
				const assistantOutput = String(
					outputValues?.output || outputValues?.response || outputValues?.text || '',
				).trim();

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

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
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

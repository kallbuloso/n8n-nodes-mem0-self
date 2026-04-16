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
let BufferWindowMemory: any;
let logWrapper: any;

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
		} catch {
			// continue
		}
	}

	if (!HumanMessage || !AIMessage) {
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
	} catch {
		BufferWindowMemory = null;
	}

	try {
		const aiUtils = require('@n8n/ai-utilities');
		logWrapper = aiUtils.logWrapper;
	} catch {
		logWrapper = null;
	}
})();

function toMessageContent(memory: any): string {
	return memory?.memory ?? memory?.text ?? memory?.content ?? '';
}

function toLangchainMessage(memory: any): any {
	const content = toMessageContent(memory);
	const role = String(memory?.metadata?.role || memory?.role || '').toLowerCase();

	// Ensure message has full LangChain structure
	const createMsg = (MsgClass: any) => {
		const msg = new MsgClass(content);
		msg.additional_kwargs = memory?.additional_kwargs || {};
		msg.response_metadata = memory?.response_metadata || {};
		return msg;
	};

	if (role === 'user' || role === 'human') return createMsg(HumanMessage);
	if (role === 'assistant' || role === 'ai') return createMsg(AIMessage);
	return createMsg(SystemMessage);
}

function wrapMemoryResponse(memory: any, ctx: ISupplyDataFunctions): any {
	if (typeof logWrapper === 'function') {
		return logWrapper(memory, ctx);
	}
	return memory;
}

type Mem0Scope = {
	user_id: string;
	agent_id: string;
	run_id?: string;
};

class Mem0ChatHistory {
	private readonly maxMessageLength: number;
	private readonly inferOnStore: boolean;
	private readonly storeStrategy: 'conversation' | 'facts_only';

	constructor(
		private readonly ctx: ISupplyDataFunctions,
		private readonly scope: Mem0Scope,
		options: { maxMessageLength: number; inferOnStore: boolean; storeStrategy: 'conversation' | 'facts_only' },
	) {
		this.maxMessageLength = options.maxMessageLength;
		this.inferOnStore = options.inferOnStore;
		this.storeStrategy = options.storeStrategy;
	}

	private normalizeRole(message: any): 'user' | 'assistant' {
		const role = String(message?.role || message?.type || message?._getType?.() || '').toLowerCase();
		if (role === 'assistant' || role === 'ai') return 'assistant';
		return 'user';
	}

	private normalizeContent(message: any): string {
		if (typeof message === 'string') return message;
		return String(message?.content ?? '');
	}

	private async append(role: 'user' | 'assistant', content: string): Promise<void> {
		if (this.storeStrategy === 'facts_only' && role !== 'user') {
			return;
		}

		const normalized = String(content || '').trim();
		if (!normalized) return;
		if (normalized.length > this.maxMessageLength) {
			throw new NodeOperationError(
				this.ctx.getNode(),
				`${role === 'user' ? 'User' : 'Assistant'} message is too long. Maximum supported length is ${this.maxMessageLength} characters.`,
			);
		}

		await mem0ApiRequest.call(this.ctx, 'POST', '/memories', {
			messages: [{ role, content: normalized }],
			infer: this.inferOnStore,
			metadata: {
				source: 'n8n_mem0_memory_safe',
				role,
				channel: 'chat',
				memory_type: this.storeStrategy === 'facts_only' ? 'fact' : 'conversation',
			},
			...this.scope,
		});
	}

	async getMessages(): Promise<any[]> {
		// Search-first mode: history retrieval is handled by loadMemoryVariables/query.
		return [];
	}

	async addMessage(message: any): Promise<void> {
		const role = this.normalizeRole(message);
		const content = this.normalizeContent(message);
		await this.append(role, content);
	}

	async addMessages(messages: any[]): Promise<void> {
		for (const message of messages || []) {
			await this.addMessage(message);
		}
	}

	async addUserMessage(message: string): Promise<void> {
		await this.append('user', message);
	}

	async addAIMessage(message: string): Promise<void> {
		await this.append('assistant', message);
	}

	async addAIChatMessage(message: string): Promise<void> {
		await this.append('assistant', message);
	}

	// Safe profile: intentionally non-destructive.
	async clear(): Promise<void> {
		return;
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
				displayName: 'Memory Mode',
				name: 'memoryMode',
				type: 'options',
				default: 'semantic_facts',
				options: [
					{
						name: 'Semantic Facts',
						value: 'semantic_facts',
						description: 'Retrieves relevant facts via semantic search',
					},
					{
						name: 'Conversation Pairs',
						value: 'conversation_pairs',
						description: 'Loads chronological human + AI conversation turns',
					},
				],
				description: 'Memory retrieval strategy for AI Agent context',
			},
			{
				displayName: 'Buffer Limit (Interactions)',
				name: 'bufferLimit',
				type: 'number',
				default: 20,
				typeOptions: { minValue: 1, maxValue: 200 },
				description: 'How many latest user+assistant interactions to include in conversation mode',
				displayOptions: {
					show: {
						memoryMode: ['conversation_pairs'],
					},
				},
			},
			{
				displayName: 'Fallback to Search on Buffer Miss',
				name: 'fallbackToSearchOnBufferMiss',
				type: 'boolean',
				default: true,
				description: 'When the buffer appears unrelated to the current query, fallback to Mem0 semantic search',
				displayOptions: {
					show: {
						memoryMode: ['conversation_pairs'],
					},
				},
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
						description: 'Uses buffer first, then falls back to search when relevance is low',
					},
					{
						name: 'Search First',
						value: 'search_first',
						description: 'Always retrieves with semantic search first, then falls back to buffer if empty',
					},
					{
						name: 'Buffer First',
						value: 'buffer_first',
						description: 'Always uses recent buffer only',
					},
				],
				description: 'How conversation mode chooses between buffer and semantic retrieval',
				displayOptions: {
					show: {
						memoryMode: ['conversation_pairs'],
					},
				},
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
						description: 'Prioritizes user factual memories with safe fallbacks',
					},
					{
						name: 'Strict Facts',
						value: 'strict_facts',
						description: 'Prefers user factual memories only',
					},
					{
						name: 'Legacy',
						value: 'legacy',
						description: 'Previous compatibility behavior',
					},
				],
				description: 'Retrieval strategy used for search results post-processing',
			},
			{
				displayName: 'Max Context Characters',
				name: 'maxContextChars',
				type: 'number',
				default: 700,
				typeOptions: { minValue: 100, maxValue: 8000 },
				description: 'Maximum total characters injected into AI context after retrieval',
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
				displayName: 'Store Strategy',
				name: 'storeStrategy',
				type: 'options',
				default: 'conversation',
				options: [
					{
						name: 'Conversation (Compatible)',
						value: 'conversation',
						description: 'Stores user and assistant turns',
					},
					{
						name: 'Facts Only',
						value: 'facts_only',
						description: 'Stores user factual signals and avoids assistant turn noise',
					},
				],
				description: 'How messages are persisted into memory',
			},
			{
				displayName: 'Search Filters (JSON)',
				name: 'searchFilters',
				type: 'string',
				default: '',
				description: 'Optional JSON filters passed to Mem0 search payload',
			},
			{
				displayName: 'Allow Empty Context',
				name: 'allowEmptyContext',
				type: 'boolean',
				default: false,
				description: 'If disabled, retrieval automatically falls back before returning empty context',
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

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const MAX_MESSAGE_LENGTH = 10000;
		const MAX_QUERY_LENGTH = 2000;
		const FALLBACK_QUERY = 'user profile, preferences, and important facts';

		const userId = String(this.getNodeParameter('userId', itemIndex, '') || '').trim();
		const agentId = String(this.getNodeParameter('agentId', itemIndex, '') || '').trim();
		const runId = String(this.getNodeParameter('runId', itemIndex, '') || '').trim();
		const topK = Math.min(
			50,
			Math.max(1, Math.floor(Number(this.getNodeParameter('topK', itemIndex, 10) || 10))),
		);
		const memoryMode = String(this.getNodeParameter('memoryMode', itemIndex, 'semantic_facts') || 'semantic_facts') as
			| 'semantic_facts'
			| 'conversation_pairs';
		const bufferLimit = Math.max(
			1,
			Math.floor(Number(this.getNodeParameter('bufferLimit', itemIndex, 20) || 20)),
		);
		const defaultQuery = String(this.getNodeParameter('defaultQuery', itemIndex, '') || '').trim();
		const rerank = Boolean(this.getNodeParameter('rerank', itemIndex, false));
		const fieldsInput = String(this.getNodeParameter('fields', itemIndex, '') || '').trim();
		const searchMode = String(this.getNodeParameter('searchMode', itemIndex, 'balanced') || 'balanced') as
			| 'balanced'
			| 'strict_facts'
			| 'legacy';
		const maxContextChars = Math.max(
			100,
			Math.floor(Number(this.getNodeParameter('maxContextChars', itemIndex, 700) || 700)),
		);
		const includeAssistantMemories = Boolean(
			this.getNodeParameter('includeAssistantMemories', itemIndex, false),
		);
		const storeStrategy = String(
			this.getNodeParameter('storeStrategy', itemIndex, 'conversation') || 'conversation',
		) as 'conversation' | 'facts_only';
		const fallbackToSearchOnBufferMiss = Boolean(
			this.getNodeParameter('fallbackToSearchOnBufferMiss', itemIndex, true),
		);
		const conversationRetrievalPolicy = String(
			this.getNodeParameter('conversationRetrievalPolicy', itemIndex, 'smart_fallback') || 'smart_fallback',
		) as 'smart_fallback' | 'search_first' | 'buffer_first';
		const searchFiltersInput = String(this.getNodeParameter('searchFilters', itemIndex, '') || '').trim();
		const allowEmptyContext = Boolean(this.getNodeParameter('allowEmptyContext', itemIndex, false));
		const inferOnStore = Boolean(this.getNodeParameter('infer', itemIndex, false));

		if (!userId || !agentId) {
			throw new NodeOperationError(this.getNode(), 'User ID and Agent ID are required.');
		}

		const scope: Mem0Scope = {
			user_id: userId,
			agent_id: agentId,
		};
		if (runId) scope.run_id = runId;

		const chatHistory = new Mem0ChatHistory(this, scope, {
			maxMessageLength: MAX_MESSAGE_LENGTH,
			inferOnStore,
			storeStrategy,
		});

		const loadConversationMessages = async (): Promise<any[]> => {
			// Conversation buffer is intentionally strict-scoped to avoid bringing all historical chats.
			const strictScope: Record<string, unknown> = runId
				? { user_id: scope.user_id, agent_id: scope.agent_id, run_id: scope.run_id }
				: { user_id: scope.user_id, agent_id: scope.agent_id };

			const response = await mem0ApiRequest.call(this, 'GET', '/memories', {}, strictScope);
			const results = extractResults(response);

			const normalized = results
				.filter((entry: any) => {
					const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase();
					return role === 'user' || role === 'human' || role === 'assistant' || role === 'ai';
				})
				.sort((a: any, b: any) => {
					const aTs = new Date(a?.created_at || a?.updated_at || 0).getTime() || 0;
					const bTs = new Date(b?.created_at || b?.updated_at || 0).getTime() || 0;
					return bTs - aTs; // descendente: mais recentes primeiro
				});

			const maxMessages = bufferLimit * 2;
			// Pega os N mais recentes e reverte para ordem cronológica
			return normalized.slice(0, maxMessages).reverse().map((entry: any) => toLangchainMessage(entry));
		};

		const shouldFallbackToSearch = (values: any, bufferMessages: any[]): boolean => {
			if (!fallbackToSearchOnBufferMiss) return false;
			if (bufferMessages.length === 0) return true;
			const query = String(
				values?.input || values?.query || values?.human_input || values?.chatInput || values?.text || values?.message || '',
			)
				.trim()
				.toLowerCase();
			if (!query) return false;

			const bufferText = bufferMessages
				.map((m: any) => String(m?.content || ''))
				.join(' ')
				.toLowerCase();

			const stopwords = new Set([
				'a', 'an', 'and', 'are', 'as', 'at', 'do', 'for', 'from', 'how', 'i', 'in', 'is', 'it',
				'me', 'my', 'of', 'on', 'or', 'the', 'to', 'was', 'what', 'where', 'who',
				'com', 'como', 'da', 'de', 'do', 'e', 'ele', 'ela', 'em', 'eu', 'isso', 'meu', 'minha',
				'na', 'no', 'o', 'os', 'para', 'por', 'qual', 'que', 'se', 'uma', 'um',
				'yo', 'mi', 'donde', 'el', 'la', 'los', 'las', 'un', 'una',
			]);

			const tokens = query
				.split(/[^a-z0-9]+/i)
				.map((t) => t.trim())
				.filter((t) => t.length >= 3 && !stopwords.has(t));

			if (tokens.length === 0) return false;
			const matchedCount = tokens.filter((t) => bufferText.includes(t)).length;
			const coverage = matchedCount / tokens.length;

			if (matchedCount === 0) return true;
			if (tokens.length >= 3 && coverage < 0.6) return true;
			if (tokens.length >= 5 && matchedCount < 2) return true;
			return false;
		};

		const searchMessages = async (values: any): Promise<any[]> => {
			const rawQuery = String(
				values?.input ||
				values?.query ||
				values?.human_input ||
				values?.chatInput ||
				values?.text ||
				values?.message ||
				defaultQuery ||
				'',
			).trim();

			const effectiveQuery = rawQuery || FALLBACK_QUERY;
			if (effectiveQuery.length > MAX_QUERY_LENGTH) {
				throw new NodeOperationError(
					this.getNode(),
					`Search query is too long. Maximum supported length is ${MAX_QUERY_LENGTH} characters.`,
				);
			}

			const fields = fieldsInput
				? fieldsInput
						.split(',')
						.map((field) => field.trim())
						.filter((field) => field.length > 0)
				: undefined;

			let searchFilters: Record<string, unknown> | undefined;
			if (searchFiltersInput) {
				try {
					searchFilters = JSON.parse(searchFiltersInput);
				} catch {
					throw new NodeOperationError(this.getNode(), 'Search Filters (JSON) is not valid JSON.');
				}
			}

			const scopeCandidates: Array<Record<string, unknown>> = [];
			// 1) Most strict
			scopeCandidates.push({ ...scope });
			// 2) Relax run_id
			scopeCandidates.push({
				user_id: scope.user_id,
				agent_id: scope.agent_id,
			});
			// 3) User-only fallback
			scopeCandidates.push({
				user_id: scope.user_id,
			});

			let results: any[] = [];
			let filteredAttempt = Boolean(searchFilters && Object.keys(searchFilters).length > 0);
			const strictFactsMode = searchMode === 'strict_facts';
			for (const scopeCandidate of scopeCandidates) {
				const body: Record<string, unknown> = {
					query: effectiveQuery,
					top_k: topK,
					rerank,
					...scopeCandidate,
				};
				if (fields) body.fields = fields;
				if (searchFilters) body.filters = searchFilters;

				const response = await mem0ApiRequest.call(this, 'POST', '/search', body);
				results = extractResults(response);
				if (results.length > 0) break;
			}

			// Fallback: if strict/filtered attempt returned nothing, retry without filters on the same cascade.
			if (!allowEmptyContext && results.length === 0 && filteredAttempt) {
				for (const scopeCandidate of scopeCandidates) {
					const body: Record<string, unknown> = {
						query: effectiveQuery,
						top_k: topK,
						rerank,
						...scopeCandidate,
					};
					if (fields) body.fields = fields;
					const response = await mem0ApiRequest.call(this, 'POST', '/search', body);
					results = extractResults(response);
					if (results.length > 0) break;
				}
			}

			const strictFactsLocallyFiltered = strictFactsMode
				? results.filter((entry: any) => {
						const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase();
						const memoryType = String(entry?.metadata?.memory_type || '').toLowerCase();
						return role === 'user' || role === 'human' || memoryType === 'fact';
				  })
				: results;
			const strictBaseResults = strictFactsLocallyFiltered.length > 0 ? strictFactsLocallyFiltered : results;

			const userOnlyOrAll = strictBaseResults.filter((entry: any) => {
				if (searchMode === 'legacy' && includeAssistantMemories) return true;
				if (searchMode === 'legacy' && !includeAssistantMemories) {
					const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase();
					return role === 'user' || role === 'human' || role === 'assistant' || role === 'ai';
				}
				if (includeAssistantMemories) return true;
				const role = String(entry?.metadata?.role || entry?.role || '').toLowerCase();
				return role === 'user' || role === 'human';
			});
			const roleFiltered = userOnlyOrAll.length > 0 ? userOnlyOrAll : results;

			const contentSanitized = roleFiltered.filter((entry: any) => {
				const text = toMessageContent(entry).trim();
				if (!text) return false;
				// Drop obvious non-memory placeholders.
				if (text.includes('$input.first().json')) return false;
				return true;
			});
			const sanitized = contentSanitized.length > 0 ? contentSanitized : roleFiltered;

			// De-duplicate by normalized content, keeping the newest instance.
			const dedupMap = new Map<string, { entry: any; index: number; ts: number }>();
			sanitized.forEach((entry: any, index: number) => {
				const key = toMessageContent(entry).trim().toLowerCase();
				const ts = new Date(entry?.created_at || entry?.updated_at || 0).getTime() || 0;
				const prev = dedupMap.get(key);
				if (!prev || ts > prev.ts) {
					dedupMap.set(key, { entry, index, ts });
				}
			});

			// Keep Mem0 search ranking as primary signal; recency only breaks ties.
			const ordered = [...dedupMap.values()].sort((a, b) => {
				if (a.index !== b.index) return a.index - b.index;
				return b.ts - a.ts;
			});

			const topKEntries = ordered.slice(0, topK).map((x) => x.entry);
			let charBudget = maxContextChars;
			const finalResults: any[] = [];
			for (const entry of topKEntries) {
				const content = toMessageContent(entry);
				if (!content) continue;
				const nextCost = content.length;
				if (finalResults.length > 0 && nextCost > charBudget) continue;
				if (nextCost > charBudget && finalResults.length === 0) {
					finalResults.push({
						...entry,
						memory: content.slice(0, charBudget),
					});
					charBudget = 0;
					break;
				}
				finalResults.push(entry);
				charBudget -= nextCost;
				if (charBudget <= 0) break;
			}

			if (!allowEmptyContext && finalResults.length === 0 && results.length > 0) {
				finalResults.push(results[0]);
			}

			return finalResults.map((entry: any) => toLangchainMessage(entry));
		};

		const resolveConversationMessages = async (
			values: any,
			retrieveFn: (inputValues: any) => Promise<any[]>,
		): Promise<any[]> => {
			const bufferMessages = await loadConversationMessages();
			if (conversationRetrievalPolicy === 'buffer_first') {
				return bufferMessages;
			}
			if (conversationRetrievalPolicy === 'search_first') {
				const searchResults = await retrieveFn(values);
				return searchResults.length > 0 ? searchResults : bufferMessages;
			}
			return shouldFallbackToSearch(values, bufferMessages)
				? await retrieveFn(values)
				: bufferMessages;
		};

		const memory = BufferWindowMemory
			? (() => {
					class SearchFirstBufferMemory extends BufferWindowMemory {
						private readonly retrieveFn: (values: any) => Promise<any[]>;

						constructor(fields: any, retrieveFn: (values: any) => Promise<any[]>) {
							super(fields);
							this.retrieveFn = retrieveFn;
						}

						async loadMemoryVariables(values: any): Promise<Record<string, any>> {
							let messages: any[];
							if (memoryMode === 'conversation_pairs') {
								messages = await resolveConversationMessages(values, this.retrieveFn);
							} else {
								messages = await this.retrieveFn(values);
							}
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
					async loadMemoryVariables(values: any) {
						if (memoryMode === 'conversation_pairs') {
							return {
								chat_history: await resolveConversationMessages(values, searchMessages),
							};
						}
						return { chat_history: await searchMessages(values) };
					},
					async saveContext(inputValues: any, outputValues: any) {
						const userInput = String(
							inputValues?.input || inputValues?.query || inputValues?.human_input || inputValues?.chatInput || '',
						).trim();
						const assistantOutput = String(
							outputValues?.output || outputValues?.response || outputValues?.text || '',
						).trim();
						if (userInput) await chatHistory.addUserMessage(userInput);
						if (assistantOutput) await chatHistory.addAIMessage(assistantOutput);
					},
					async clear() {
						return;
					},
			  };

  // Return memory with correct LangChain key structure
  const wrappedMemory = wrapMemoryResponse(memory, this);
  if (wrappedMemory && typeof wrappedMemory === 'object') {
    wrappedMemory.memoryKey = wrappedMemory.memoryKey || 'chat_history';
  }
  return { response: wrappedMemory };
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


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
	if (role === 'user' || role === 'human') return new HumanMessage(content);
	if (role === 'assistant' || role === 'ai') return new AIMessage(content);
	return new SystemMessage(content);
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
	private readonly contextWindowLength: number;

	constructor(
		private readonly ctx: ISupplyDataFunctions,
		private readonly scope: Mem0Scope,
		options: { maxMessageLength: number; contextWindowLength: number },
	) {
		this.maxMessageLength = options.maxMessageLength;
		this.contextWindowLength = options.contextWindowLength;
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

	private normalizeByTimestamp(memories: any[]): any[] {
		return [...memories].sort((a: any, b: any) => {
			const aTs = new Date(a?.created_at || a?.updated_at || 0).getTime() || 0;
			const bTs = new Date(b?.created_at || b?.updated_at || 0).getTime() || 0;
			return aTs - bTs;
		});
	}

	private async append(role: 'user' | 'assistant', content: string): Promise<void> {
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
			infer: false,
			metadata: { source: 'n8n_mem0_memory_safe', role },
			...this.scope,
		});
	}

	async getMessages(): Promise<any[]> {
		const response = await mem0ApiRequest.call(this.ctx, 'GET', '/memories', {}, this.scope);
		const rawMemories = extractResults(response);
		const ordered = this.normalizeByTimestamp(rawMemories);

		// Align with n8n chat-memory behavior: contextWindowLength represents exchanges.
		const maxEntries = Math.max(1, this.contextWindowLength) * 2;
		const windowed = ordered.slice(-maxEntries);

		return windowed.map((entry: any) => toLangchainMessage(entry));
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
				displayName: 'Context Window Length',
				name: 'topK',
				type: 'number',
				default: 10,
				typeOptions: { minValue: 1, maxValue: 50 },
				description: 'Number of recent exchanges to inject (internally converted to messages)',
			},
			{
				displayName: 'Infer on Store',
				name: 'infer',
				type: 'boolean',
				default: false,
				description: 'Legacy toggle kept for compatibility. Safe profile stores raw chat turns.',
			},
			{
				displayName: 'Default Query (Legacy)',
				name: 'defaultQuery',
				type: 'string',
				default: '',
				description: 'Legacy field kept for workflow compatibility (not used in persistent chat mode)',
			},
			{
				displayName: 'Rerank (Legacy)',
				name: 'rerank',
				type: 'boolean',
				default: false,
				description: 'Legacy field kept for workflow compatibility (not used)',
			},
			{
				displayName: 'Fields (Legacy)',
				name: 'fields',
				type: 'string',
				default: '',
				description: 'Legacy field kept for workflow compatibility (not used)',
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const MAX_MESSAGE_LENGTH = 10000;

		const userId = String(this.getNodeParameter('userId', itemIndex, '') || '').trim();
		const agentId = String(this.getNodeParameter('agentId', itemIndex, '') || '').trim();
		const runId = String(this.getNodeParameter('runId', itemIndex, '') || '').trim();
		const contextWindowLength = Math.min(
			50,
			Math.max(1, Math.floor(Number(this.getNodeParameter('topK', itemIndex, 10) || 10))),
		);

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
			contextWindowLength,
		});

		const memory = BufferWindowMemory
			? new BufferWindowMemory({
					memoryKey: 'chat_history',
					chatHistory,
					returnMessages: true,
					inputKey: 'input',
					outputKey: 'output',
					k: contextWindowLength,
			  })
			: {
					memoryKey: 'chat_history',
					chatHistory,
					returnMessages: true,
					inputKey: 'input',
					outputKey: 'output',
					async loadMemoryVariables() {
						return { chat_history: await chatHistory.getMessages() };
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

		return { response: wrapMemoryResponse(memory, this) };
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

import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class Mem0SelfHostedApi implements ICredentialType {
	name = 'mem0SelfHostedApi';
	displayName = 'Mem0 Self-Hosted API';
	documentationUrl = 'https://docs.mem0.ai/open-source/features/rest-api';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'http://localhost:8000',
			required: true,
			description: 'The base URL of your self-hosted Mem0 instance',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'API key used in X-API-Key header',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/docs',
			method: 'GET',
		},
	};
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mem0SelfHostedApi = void 0;
class Mem0SelfHostedApi {
    constructor() {
        this.name = 'mem0SelfHostedApi';
        this.displayName = 'Mem0 Self-Hosted API';
        this.documentationUrl = 'https://docs.mem0.ai/open-source/features/rest-api';
        this.properties = [
            {
                displayName: 'Base URL',
                name: 'baseUrl',
                type: 'string',
                default: 'https://memor.curta.se',
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
        this.authenticate = {
            type: 'generic',
            properties: {
                headers: {
                    'X-API-Key': '={{$credentials.apiKey}}',
                },
            },
        };
        this.test = {
            request: {
                baseURL: '={{$credentials.baseUrl}}',
                url: '/docs',
                method: 'GET',
            },
        };
    }
}
exports.Mem0SelfHostedApi = Mem0SelfHostedApi;
//# sourceMappingURL=Mem0SelfHostedApi.credentials.js.map
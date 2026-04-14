import type {
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

type Ctx = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

/**
 * Extracts the memories array from an API response.
 * Self-hosted usually returns arrays directly, but can also wrap results in
 * { results: [...], relations: [...] }.
 */
export function extractResults(res: any): any[] {
	if (Array.isArray(res)) return res;
	if (res?.results && Array.isArray(res.results)) return res.results;
	if (res) return [res];
	return [];
}

/**
 * Shared API request helper used by all Mem0 nodes.
 * Sends requests to Mem0 Self-Hosted REST API.
 */
export async function mem0ApiRequest(
	this: Ctx,
	method: string,
	endpoint: string,
	body: Record<string, any> = {},
	qs: Record<string, any> = {},
): Promise<any> {
	const credentials = await this.getCredentials('mem0SelfHostedApi');
	const baseUrl = (credentials.baseUrl as string).replace(/\/$/, '');
	const resolvedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

	const options: IHttpRequestOptions = {
		method: method as IHttpRequestOptions['method'],
		body,
		qs,
		url: `${baseUrl}${resolvedEndpoint}`,
	};

	if (credentials.apiKey) {
		options.headers = { 'X-API-Key': credentials.apiKey as string };
	}

	try {
		return await (this as IExecuteFunctions).helpers.httpRequest(options);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as any);
	}
}

import type {
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IHttpRequestOptions,
	ISupplyDataFunctions,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

type Ctx = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions | ISupplyDataFunctions;

/**
 * Extracts the memories array from an API response.
 * Self-hosted usually returns arrays directly, but can also wrap results in
 * { results: [...], relations: [...] } or nested structures like { data: { results: [...] } }.
 */
export function extractResults(res: any): any[] {
	if (Array.isArray(res)) return res;
	// Handle nested { data: { results: [...] } }
	if (res?.data?.results && Array.isArray(res.data.results)) return res.data.results;
	if (res?.results && Array.isArray(res.results)) return res.results;
	if (res?.memories && Array.isArray(res.memories)) return res.memories;
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
	const methodUpper = method.toUpperCase();
	const hasBody = body && Object.keys(body).length > 0 && !['GET', 'DELETE'].includes(methodUpper);

	const options: IHttpRequestOptions = {
		method: methodUpper as IHttpRequestOptions['method'],
		qs,
		url: `${baseUrl}${resolvedEndpoint}`,
		json: true,
	};
	if (hasBody) {
		options.body = body;
	}

	const headers: Record<string, string> = {};
	if (hasBody) {
		headers['Content-Type'] = 'application/json';
	}

	if (credentials.apiKey) {
		headers['X-API-Key'] = credentials.apiKey as string;
	}

	if (Object.keys(headers).length > 0) {
		options.headers = headers;
	}

	try {
		return await (this as IExecuteFunctions).helpers.httpRequest(options);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as any);
	}
}

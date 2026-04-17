"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractResults = extractResults;
exports.mem0ApiRequest = mem0ApiRequest;
const n8n_workflow_1 = require("n8n-workflow");
/**
 * Extracts the memories array from an API response.
 * Self-hosted usually returns arrays directly, but can also wrap results in
 * { results: [...], relations: [...] } or nested structures like { data: { results: [...] } }.
 */
function extractResults(res) {
    if (Array.isArray(res))
        return res;
    // Handle nested { data: { results: [...] } }
    if (res?.data?.results && Array.isArray(res.data.results))
        return res.data.results;
    if (res?.results && Array.isArray(res.results))
        return res.results;
    if (res?.memories && Array.isArray(res.memories))
        return res.memories;
    if (res)
        return [res];
    return [];
}
/**
 * Shared API request helper used by all Mem0 nodes.
 * Sends requests to Mem0 Self-Hosted REST API.
 */
async function mem0ApiRequest(method, endpoint, body = {}, qs = {}) {
    const credentials = await this.getCredentials('mem0SelfHostedApi');
    const baseUrl = credentials.baseUrl.replace(/\/$/, '');
    const resolvedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const methodUpper = method.toUpperCase();
    const hasBody = body && Object.keys(body).length > 0 && !['GET', 'DELETE'].includes(methodUpper);
    const options = {
        method: methodUpper,
        qs,
        url: `${baseUrl}${resolvedEndpoint}`,
        json: true
    };
    if (hasBody) {
        options.body = body;
    }
    const headers = {};
    if (hasBody) {
        headers['Content-Type'] = 'application/json';
    }
    if (credentials.apiKey) {
        headers['X-API-Key'] = credentials.apiKey;
    }
    if (Object.keys(headers).length > 0) {
        options.headers = headers;
    }
    try {
        return await this.helpers.httpRequest(options);
    }
    catch (error) {
        throw new n8n_workflow_1.NodeApiError(this.getNode(), error);
    }
}
//# sourceMappingURL=GenericFunctions.js.map
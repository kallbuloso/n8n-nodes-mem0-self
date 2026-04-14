"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractResults = extractResults;
exports.mem0ApiRequest = mem0ApiRequest;
const n8n_workflow_1 = require("n8n-workflow");
/**
 * Extracts the memories array from an API response.
 * Self-hosted usually returns arrays directly, but can also wrap results in
 * { results: [...], relations: [...] }.
 */
function extractResults(res) {
    if (Array.isArray(res))
        return res;
    if (res?.results && Array.isArray(res.results))
        return res.results;
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
    const options = {
        method: method,
        body,
        qs,
        url: `${baseUrl}${resolvedEndpoint}`,
    };
    if (credentials.apiKey) {
        options.headers = { 'X-API-Key': credentials.apiKey };
    }
    try {
        return await this.helpers.httpRequest(options);
    }
    catch (error) {
        throw new n8n_workflow_1.NodeApiError(this.getNode(), error);
    }
}
//# sourceMappingURL=GenericFunctions.js.map
import type { IExecuteFunctions, IHookFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
type Ctx = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;
/**
 * Extracts the memories array from an API response.
 * Self-hosted usually returns arrays directly, but can also wrap results in
 * { results: [...], relations: [...] }.
 */
export declare function extractResults(res: any): any[];
/**
 * Shared API request helper used by all Mem0 nodes.
 * Sends requests to Mem0 Self-Hosted REST API.
 */
export declare function mem0ApiRequest(this: Ctx, method: string, endpoint: string, body?: Record<string, any>, qs?: Record<string, any>): Promise<any>;
export {};
//# sourceMappingURL=GenericFunctions.d.ts.map
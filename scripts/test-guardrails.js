const { Mem0 } = require('../dist/nodes/Mem0/Mem0.node.js');

function makeContext(items, paramsByItem, capturedRequests) {
  return {
    getInputData() {
      return items;
    },
    getNodeParameter(name, itemIndex, defaultValue) {
      const itemParams = paramsByItem[itemIndex] || {};
      if (Object.prototype.hasOwnProperty.call(itemParams, name)) {
        return itemParams[name];
      }
      return defaultValue;
    },
    continueOnFail() {
      return false;
    },
    getNode() {
      return { name: 'Mem0 Self-Hosted (test)' };
    },
    async getCredentials() {
      return { baseUrl: 'http://localhost:8000', apiKey: 'test-key' };
    },
    helpers: {
      async httpRequest(options) {
        capturedRequests.push(options);
        return { results: [] };
      },
    },
  };
}

async function runCase(name, params, expect) {
  const node = new Mem0();
  const captured = [];
  const ctx = makeContext([{ json: {} }], [params], captured);

  try {
    const output = await node.execute.call(ctx);
    if (expect.type === 'error') {
      return { name, ok: false, detail: `Expected error, got success: ${JSON.stringify(output)}` };
    }
    if (expect.type === 'request_top_k') {
      if (captured.length === 0) {
        return { name, ok: false, detail: 'No request captured.' };
      }
      const gotTopK = captured[0]?.body?.top_k;
      if (gotTopK !== expect.value) {
        return { name, ok: false, detail: `Expected top_k=${expect.value}, got ${gotTopK}` };
      }
      return { name, ok: true, detail: `top_k=${gotTopK}` };
    }
    return { name, ok: true, detail: 'Success as expected.' };
  } catch (err) {
    const message = err?.message || String(err);
    if (expect.type === 'error') {
      const match = expect.contains.every((s) => message.includes(s));
      return {
        name,
        ok: match,
        detail: match ? `Error matched: ${message}` : `Unexpected error message: ${message}`,
      };
    }
    return { name, ok: false, detail: `Unexpected error: ${message}` };
  }
}

async function main() {
  const longMessage = 'a'.repeat(10001);
  const longQuery = 'b'.repeat(2001);

  const base = {
    userId: 'u1',
    agentId: 'a1',
    runId: '',
  };

  const cases = [
    {
      name: 'StoreInteraction rejects empty User Message',
      params: { ...base, operation: 'storeInteraction', userMessage: '   ', assistantMessage: 'ok', infer: true },
      expect: { type: 'error', contains: ['User Message cannot be empty'] },
    },
    {
      name: 'StoreInteraction rejects empty Assistant Message',
      params: { ...base, operation: 'storeInteraction', userMessage: 'ok', assistantMessage: '   ', infer: true },
      expect: { type: 'error', contains: ['Assistant Message cannot be empty'] },
    },
    {
      name: 'StoreInteraction rejects oversized User Message',
      params: { ...base, operation: 'storeInteraction', userMessage: longMessage, assistantMessage: 'ok', infer: true },
      expect: { type: 'error', contains: ['User Message is too long', '10000'] },
    },
    {
      name: 'SearchConversation rejects empty Search Query',
      params: { ...base, operation: 'searchConversation', query: '   ', topK: 10, rerank: false, fields: '' },
      expect: { type: 'error', contains: ['Search Query cannot be empty'] },
    },
    {
      name: 'SearchConversation rejects oversized Search Query',
      params: { ...base, operation: 'searchConversation', query: longQuery, topK: 10, rerank: false, fields: '' },
      expect: { type: 'error', contains: ['Search Query is too long', '2000'] },
    },
    {
      name: 'SearchConversation clamps topK to 50',
      params: { ...base, operation: 'searchConversation', query: 'ok', topK: 999, rerank: false, fields: '' },
      expect: { type: 'request_top_k', value: 50 },
    },
    {
      name: 'SearchConversation with topK=0 currently falls back to 10',
      params: { ...base, operation: 'searchConversation', query: 'ok', topK: 0, rerank: false, fields: '' },
      expect: { type: 'request_top_k', value: 10 },
    },
  ];

  const results = [];
  for (const c of cases) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await runCase(c.name, c.params, c.expect));
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  console.log(JSON.stringify({ summary: { total: results.length, passed, failed }, results }, null, 2));
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

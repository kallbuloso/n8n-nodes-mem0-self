#!/usr/bin/env node

const baseUrl = 'https://memor.curta.se';
const apiKey = '081373f655c8db6cbabbf388b7ee62b4';

const scope = {
  user_id: `wf-objective-user-${Date.now()}`,
  agent_id: 'wf-objective-agent',
  run_id: 'wf-objective-run',
};

function buildQuery(input) {
  const query = String(input || '').trim();
  const fallbackQuery = 'user profile preferences important facts name identity recent updates';
  return query ? `${query} ${fallbackQuery}` : fallbackQuery;
}

function formatContext(results) {
  return results
    .map((item, index) => {
      const role = String(item?.role || item?.metadata?.role || 'memory').toLowerCase();
      const speaker = role === 'assistant' || role === 'ai' ? 'AI' : role === 'user' || role === 'human' ? 'Human' : 'Memory';
      const content = String(item?.memory || item?.text || item?.content || '').trim();
      if (!content) return null;
      return `${index + 1}. ${speaker}: ${content}`;
    })
    .filter(Boolean)
    .join('\n');
}

async function request(path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  return {
    status: response.status,
    ok: response.ok,
    json,
  };
}

async function main() {
  console.log('========================================');
  console.log(' Objective Workflow Logic Test');
  console.log('========================================');
  console.log(`Scope: ${JSON.stringify(scope)}`);

  const savePayload = {
    ...scope,
    infer: false,
    metadata: {
      source: 'n8n_objective_workflow',
      channel: 'webhook',
      memory_type: 'conversation',
    },
    messages: [
      { role: 'user', content: 'Meu nome e Amaral' },
      { role: 'assistant', content: 'Seu nome e Amaral' },
    ],
  };

  const saveResult = await request('/memories', savePayload);
  console.log('\nSAVE /memories');
  console.log(`status=${saveResult.status}`);
  console.log(JSON.stringify(saveResult.json, null, 2));

  if (!saveResult.ok) {
    throw new Error('Save request failed');
  }

  const rawSearch = await request('/search', {
    ...scope,
    query: 'Qual e o meu nome?',
    top_k: 6,
    rerank: false,
  });

  console.log('\nRAW SEARCH /search');
  console.log(`status=${rawSearch.status}`);
  console.log(JSON.stringify(rawSearch.json, null, 2));

  const fallbackSearch = await request('/search', {
    ...scope,
    query: buildQuery('Qual e o meu nome?'),
    top_k: 6,
    rerank: false,
  });

  console.log('\nFALLBACK SEARCH /search');
  console.log(`status=${fallbackSearch.status}`);
  console.log(JSON.stringify(fallbackSearch.json, null, 2));

  if (!fallbackSearch.ok) {
    throw new Error('Fallback search failed');
  }

  const results = Array.isArray(fallbackSearch.json?.results) ? fallbackSearch.json.results : [];
  const context = formatContext(results);

  console.log('\nFORMATTED CONTEXT');
  console.log(context || '(empty)');

  const hasAmaral = context.toLowerCase().includes('amaral');
  if (!hasAmaral) {
    throw new Error('Formatted context does not include expected fact: Amaral');
  }

  console.log('\nOK objective workflow logic validated');
}

main().catch((error) => {
  console.error('\nFAIL', error.message);
  process.exit(1);
});

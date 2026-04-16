import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : n8n Long Memory
// Nodes   : 14  |  Connections: 2
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// ChatTrigger                        chatTrigger                
// ConfigParameters                   set                        
// AiAgent                            agent                      [AI]
// OpenrouterChatModel                lmChatOpenRouter           [creds] [ai_languageModel]
// SimpleMemory                       memoryBufferWindow         [ai_memory]
// MemorySearch                       toolHttpRequest            [ai_tool]
// MemoryAdd                          toolHttpRequest            [ai_tool]
// MemoryCognify                      toolHttpRequest            [ai_tool]
// MemoryMemify                       toolHttpRequest            [ai_tool]
// MemoryFeedback                     toolHttpRequest            [ai_tool]
// MemoryDelete                       toolHttpRequest            [ai_tool]
// MemoryList                         toolHttpRequest            [ai_tool]
// DateTime                           dateTimeTool               [ai_tool]
// Think                              toolThink                  [ai_tool]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// ChatTrigger
//    → ConfigParameters
//      → AiAgent
//
// AI CONNECTIONS
// AiAgent.uses({ ai_languageModel: OpenrouterChatModel, ai_memory: SimpleMemory, ai_tool: [MemorySearch, MemoryAdd, MemoryCognify, MemoryMemify, MemoryFeedback, MemoryDelete, MemoryList, DateTime, Think] })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: "Lx10yyaOjVSaxXma",
    name: "n8n Long Memory",
    active: false,
    isArchived: false,
    projectId: "Mq8w52PdwYA2pamL",
    settings: { executionOrder: "v1", saveDataErrorExecution: "all", saveDataSuccessExecution: "all", saveManualExecutions: true, callerPolicy: "workflowsFromSameOwner", availableInMCP: false }
})
export class N8nLongMemoryWorkflow {

    // =====================================================================
// CONFIGURATION DES NOEUDS
// =====================================================================

    @node({
        id: "chat_trigger",
        webhookId: "cognee-long-memory-chat",
        name: "Chat Trigger",
        type: "@n8n/n8n-nodes-langchain.chatTrigger",
        version: 1.1,
        position: [0, 304]
    })
    ChatTrigger = {
        options: {}
    };

    @node({
        id: "edit_fields",
        name: "Config Parameters",
        type: "n8n-nodes-base.set",
        version: 3.4,
        position: [224, 304]
    })
    ConfigParameters = {
        assignments: {
            assignments: [
                {
                    id: "cognee_base_url",
                    name: "cogneeBaseUrl",
                    value: "https://cognee.curta.se",
                    type: "string"
                },
                {
                    id: "dataset_name",
                    name: "datasetName",
                    value: "chat_memory",
                    type: "string"
                },
                {
                    id: "search_type",
                    name: "defaultSearchType",
                    value: "GRAPH_COMPLETION",
                    type: "string"
                },
                {
                    id: "top_k",
                    name: "topK",
                    value: 5,
                    type: "number"
                },
                {
                    id: "run_background",
                    name: "runInBackground",
                    value: "true",
                    type: "boolean"
                },
                {
                    id: "chat_input",
                    name: "chatInput",
                    value: "={{ $json.chatInput }}",
                    type: "string"
                },
                {
                    id: "session_id",
                    name: "sessionId",
                    value: "={{ $json.sessionId }}",
                    type: "string"
                }
            ]
        },
        includeOtherFields: true,
        options: {}
    };

    @node({
        id: "ai_agent",
        name: "AI Agent",
        type: "@n8n/n8n-nodes-langchain.agent",
        version: 1.7,
        position: [480, 304]
    })
    AiAgent = {
        promptType: "define",
        text: "={{ $json.chatInput }}",
        options: {
            systemMessage: `=Você é um assistente inteligente com memória de longo prazo usando Cognee.

## INSTRUÇÕES IMPORTANTES:

### Fluxo de Resposta:
1. **SEMPRE** comece usando a tool \`memory_search\` para buscar contexto relevante na memória
2. Use o contexto encontrado para personalizar sua resposta
3. Se a informação for nova e relevante, use \`memory_add\` para salvar
4. Analise o sentimento da interação e use \`memory_feedback\` quando apropriado

### Uso das Tools:
- \`memory_search\`: Use SEMPRE no início para buscar contexto. O parâmetro query deve conter a pergunta ou termo de busca.
- \`memory_add\`: Salve informações importantes que o usuário compartilha (preferências, fatos, contexto)
- \`memory_cognify\`: Execute após adicionar novos dados para processar o knowledge graph
- \`memory_memify\`: Execute após cognify para enriquecer a memória
- \`memory_feedback\`: Use para registrar feedback baseado no sentimento da conversa
- \`memory_delete\`: Use apenas quando o usuário pedir explicitamente para esquecer algo
- \`memory_list\`: Use para verificar datasets disponíveis

### Análise de Sentimento para Feedback:
- Detecte sentimentos positivos: 'obrigado', 'perfeito', 'excelente', 'isso ajudou' → feedback positivo
- Detecte sentimentos negativos: 'não entendi', 'errado', 'isso não ajuda' → feedback negativo
- Use o feedback para melhorar futuras interações

### Parâmetros Disponíveis:
- Base URL: {{ $json.cogneeBaseUrl }}
- Dataset: {{ $json.datasetName }}
- Search Type: {{ $json.defaultSearchType }}
- Top K: {{ $json.topK }}
- Session ID: {{ $json.sessionId }}

Seja conversacional, útil e mantenha contexto das interações anteriores.`,
            maxIterations: 15,
            returnIntermediateSteps: false
        }
    };

    @node({
        id: "openrouter_model",
        name: "OpenRouter Chat Model",
        type: "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
        version: 1,
        position: [304, 528],
        credentials: {openRouterApi:{id:"aUlYiqe6YVfTDAcp",name:"OpenRouter account"}}
    })
    OpenrouterChatModel = {
        model: "openai/gpt-5-nano",
        options: {
            maxTokens: 4096,
            temperature: 0.7
        }
    };

    @node({
        id: "simple_memory",
        name: "Simple Memory",
        type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
        version: 1.3,
        position: [480, 528]
    })
    SimpleMemory = {
        sessionKey: "={{ $('Config Parameters').item.json.sessionId }}",
        contextWindowLength: 10
    };

    @node({
        id: "tool_memory_search",
        name: "memory_search",
        type: "@n8n/n8n-nodes-langchain.toolHttpRequest",
        version: 1.1,
        position: [672, 528]
    })
    MemorySearch = {
        toolDescription: "Busca contexto e informações na memória de longo prazo do Cognee. Use SEMPRE no início da conversa para recuperar contexto relevante. O parâmetro query deve conter a pergunta ou termo de busca.",
        method: "POST",
        url: "={{ $('Config Parameters').item.json.cogneeBaseUrl }}/api/v1/search",
        sendHeaders: true,
        specifyHeaders: "json",
        jsonHeaders: "{\"Content-Type\": \"application/json\", \"accept\": \"application/json\"}",
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={\"searchType\": \"{{ $('Config Parameters').item.json.defaultSearchType }}\", \"datasets\": [\"{{ $('Config Parameters').item.json.datasetName }}\"], \"query\": \"{{ $('Chat Trigger').item.json.chatInput }}\", \"topK\": {{ $('Config Parameters').item.json.topK }}, \"saveInteraction\": true}"
    };

    @node({
        id: "tool_memory_add",
        name: "memory_add",
        type: "@n8n/n8n-nodes-langchain.toolHttpRequest",
        version: 1.1,
        position: [848, 528]
    })
    MemoryAdd = {
        toolDescription: "Adiciona novas informações à memória de longo prazo. Use para salvar fatos importantes, preferências do usuário, ou contexto relevante que deve ser lembrado em futuras conversas.",
        method: "POST",
        url: "={{ $('Config Parameters').item.json.cogneeBaseUrl }}/api/v1/add",
        sendHeaders: true,
        specifyHeaders: "json",
        jsonHeaders: "{\"Content-Type\": \"multipart/form-data\", \"accept\": \"multipart/form-data\"}",
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={\"datasetName\": \"{{ $('Config Parameters').item.json.datasetName }}\", \"text_data\": [\"{data}\"]}",
        placeholderDefinitions: {
            values: [
                {
                    name: "data",
                    description: "O texto ou informação a ser salva na memória. Deve ser uma string descritiva e contextualizada.",
                    type: "string"
                }
            ]
        },
        optimizeResponse: true
    };

    @node({
        id: "tool_memory_cognify",
        name: "memory_cognify",
        type: "@n8n/n8n-nodes-langchain.toolHttpRequest",
        version: 1.1,
        position: [1024, 528]
    })
    MemoryCognify = {
        toolDescription: "Processa os dados adicionados e transforma em knowledge graph estruturado. Execute após usar memory_add para processar novos dados. Roda em background.",
        method: "POST",
        url: "={{ $('Config Parameters').item.json.cogneeBaseUrl }}/api/v1/cognify",
        sendHeaders: true,
        specifyHeaders: "json",
        jsonHeaders: "{\"Content-Type\": \"application/json\", \"accept\": \"application/json\"}",
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={\"datasets\": [\"{{ $('Config Parameters').item.json.datasetName }}\"], \"datasetIds\": [], \"runInBackground\": {{ $('Config Parameters').item.json.runInBackground }}, \"customPrompt\": \"\"}",
        optimizeResponse: true
    };

    @node({
        id: "tool_memory_memify",
        name: "memory_memify",
        type: "@n8n/n8n-nodes-langchain.toolHttpRequest",
        version: 1.1,
        position: [1200, 528]
    })
    MemoryMemify = {
        toolDescription: "Enriquece e otimiza o knowledge graph após o cognify. Execute após memory_cognify para melhorar a qualidade da memória. Roda em background.",
        method: "POST",
        url: "={{ $('Config Parameters').item.json.cogneeBaseUrl }}/api/v1/memify",
        sendHeaders: true,
        specifyHeaders: "json",
        jsonHeaders: "{\"Content-Type\": \"application/json\", \"accept\": \"application/json\"}",
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={\"extractionTasks\": [], \"enrichmentTasks\": [], \"data\": \"\", \"datasetName\": \"{{ $('Config Parameters').item.json.datasetName }}\", \"nodeName\": [], \"runInBackground\": {{ $('Config Parameters').item.json.runInBackground }}}",
        optimizeResponse: true
    };

    @node({
        id: "tool_memory_feedback",
        name: "memory_feedback",
        type: "@n8n/n8n-nodes-langchain.toolHttpRequest",
        version: 1.1,
        position: [1392, 528]
    })
    MemoryFeedback = {
        toolDescription: "Envia feedback sobre a qualidade das respostas para melhorar futuras interações. Use quando detectar sentimento positivo (obrigado, perfeito, ajudou) ou negativo (não entendi, errado) na conversa. O feedback_text deve descrever se a resposta foi útil ou não.",
        method: "POST",
        url: "={{ $('Config Parameters').item.json.cogneeBaseUrl }}/api/v1/search",
        sendHeaders: true,
        specifyHeaders: "json",
        jsonHeaders: "{\"Content-Type\": \"application/json\", \"accept\": \"application/json\"}",
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={\"searchType\": \"FEEDBACK\", \"datasets\": [\"{{ $('Config Parameters').item.json.datasetName }}\"], \"query\": \"{feedback_text}\", \"lastK\": 1}",
        placeholderDefinitions: {
            values: [
                {
                    name: "feedback_text",
                    description: "Texto descrevendo o feedback. Ex: 'Resposta muito útil e precisa' ou 'Resposta não atendeu a pergunta'",
                    type: "string"
                }
            ]
        },
        optimizeResponse: true
    };

    @node({
        id: "tool_memory_delete",
        name: "memory_delete",
        type: "@n8n/n8n-nodes-langchain.toolHttpRequest",
        version: 1.1,
        position: [1568, 528]
    })
    MemoryDelete = {
        toolDescription: "Remove dados específicos da memória. Use APENAS quando o usuário pedir explicitamente para esquecer algo. Requer o data_id do item a ser removido.",
        method: "DELETE",
        url: "={{ $('Config Parameters').item.json.cogneeBaseUrl }}/api/v1/delete/{data_id}",
        sendQuery: true,
        specifyQuery: "json",
        jsonQuery: "={\"datasetName\": \"{{ $('Config Parameters').item.json.datasetName }}\"}",
        sendHeaders: true,
        specifyHeaders: "json",
        jsonHeaders: "{\"Content-Type\": \"application/json\", \"accept\": \"application/json\"}",
        placeholderDefinitions: {
            values: [
                {
                    name: "data_id",
                    description: "O ID único do dado a ser removido da memória",
                    type: "string"
                }
            ]
        },
        optimizeResponse: true
    };

    @node({
        id: "tool_memory_list",
        name: "memory_list",
        type: "@n8n/n8n-nodes-langchain.toolHttpRequest",
        version: 1.1,
        position: [1744, 528]
    })
    MemoryList = {
        toolDescription: "Lista todos os datasets disponíveis na memória. Use para verificar quais datasets existem e seus status.",
        url: "={{ $('Config Parameters').item.json.cogneeBaseUrl }}/api/v1/datasets",
        sendHeaders: true,
        specifyHeaders: "json",
        jsonHeaders: "{\"accept\": \"application/json\"}",
        optimizeResponse: true
    };

    @node({
        id: "27c42212-a5e7-44bd-ba47-524ef6456cab",
        name: "Date & Time",
        type: "n8n-nodes-base.dateTimeTool",
        version: 2,
        position: [512, 816]
    })
    DateTime = {
        options: {}
    };

    @node({
        id: "7f7ec8f9-1033-4bc3-98ad-68e234fb63b1",
        name: "Think",
        type: "@n8n/n8n-nodes-langchain.toolThink",
        version: 1.1,
        position: [336, 736]
    })
    Think = {};


    // =====================================================================
// ROUTAGE ET CONNEXIONS
// =====================================================================

    @links()
    defineRouting() {
        this.ChatTrigger.out(0).to(this.ConfigParameters.in(0));
        this.ConfigParameters.out(0).to(this.AiAgent.in(0));

        this.AiAgent.uses({
            ai_languageModel: this.OpenrouterChatModel.output,
            ai_memory: this.SimpleMemory.output,
            ai_tool: [this.MemorySearch.output, this.MemoryAdd.output, this.MemoryCognify.output, this.MemoryMemify.output, this.MemoryFeedback.output, this.MemoryDelete.output, this.MemoryList.output, this.DateTime.output, this.Think.output]
        });
    }
}
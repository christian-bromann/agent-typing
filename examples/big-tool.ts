import { z } from 'zod';
import { createMiddleware, createAgent } from '../agent.js';

/**
 * Tool categories for the tools to select from
 */
const TOOL_CATEGORIES = {
    search: ['web_search', 'code_search', 'docs_search'],
    file: ['read_file', 'write_file', 'delete_file', 'list_files'],
    data: ['query_database', 'analyze_csv', 'transform_json'],
    api: ['call_api', 'webhook_trigger', 'graphql_query'],
    math: ['calculate', 'plot_graph', 'statistical_analysis'],
};

/**
 * Keyword mapping for tool selection
 */
const KEYWORD_MAP: Record<string, string[]> = {
    search: ['search', 'find', 'look for', 'query'],
    file: ['file', 'read', 'write', 'save', 'open', 'create'],
    data: ['data', 'analyze', 'csv', 'database', 'transform'],
    api: ['api', 'webhook', 'endpoint', 'request'],
    math: ['calculate', 'compute', 'graph', 'plot', 'statistics'],
};

/**
 * Big Tool Middleware - Intelligently selects relevant tools from a large set
 * 
 * This middleware analyzes the user's query and current conversation to
 * select only the most relevant tools, reducing model confusion and costs.
 */
export const bigToolMiddleware = createMiddleware({
  name: 'BigToolMiddleware',
  stateSchema: z.object({
    // Track tool usage for optimization
    toolUsageCount: z.record(z.string(), z.number()).default({}),
  }),
  contextSchema: z.object({
    // All available tools grouped by category
    toolCategories: z.record(z.string(), z.array(z.string())).default(TOOL_CATEGORIES),
    // Maximum tools to include per request
    maxToolsPerRequest: z.number().default(5),
    // Enable keyword-based selection
    enableKeywordMatching: z.boolean().default(true),
  }),
  prepareCall: (options, state, runtime) => {
    const messages = options.messages || state.messages;
    const allTools = Object.values(runtime.context.toolCategories).flat();
    
    // Get the last user message for analysis
    const lastUserMessage = messages
      .filter(msg => msg.role === 'user')
      .pop()?.content || '';
    
    // Select relevant tool categories based on keywords
    const selectedCategories = new Set<string>();
    const lowerMessage = lastUserMessage.toLowerCase();
    
    if (runtime.context.enableKeywordMatching) {
      for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
        if (keywords.some(keyword => lowerMessage.includes(keyword))) {
          selectedCategories.add(category);
        }
      }
    }
    
    // If no categories matched, use most frequently used tools
    let selectedTools: string[] = [];
    
    if (selectedCategories.size > 0) {
      // Get tools from selected categories
      for (const category of selectedCategories) {
        const categoryTools = runtime.context.toolCategories[category] || [];
        selectedTools.push(...categoryTools);
      }
    } else {
      // Fall back to most used tools
      const sortedTools = Object.entries(state.toolUsageCount)
        .sort(([, a], [, b]) => b - a)
        .slice(0, runtime.context.maxToolsPerRequest)
        .map(([tool]) => tool);
      
      selectedTools = sortedTools.length > 0 ? sortedTools : allTools.slice(0, runtime.context.maxToolsPerRequest);
    }
    
    // Limit to maxToolsPerRequest
    selectedTools = selectedTools.slice(0, runtime.context.maxToolsPerRequest);
    
    return {
      ...options,
      tools: selectedTools,
    };
  },
  afterModel: async (state, runtime) => {
    // Update tool usage statistics based on what was actually called
    const usedTools = runtime.toolCalls.map(call => call.name);
    const updatedUsageCount = { ...state.toolUsageCount };
    
    for (const tool of usedTools) {
      updatedUsageCount[tool] = (updatedUsageCount[tool] || 0) + 1;
    }
    
    return {
      toolUsageCount: updatedUsageCount,
    };
  },
});

// Example usage
const agent = createAgent({
  middlewares: [bigToolMiddleware] as const,
});

// Example with a large tool set
const result = await agent.invoke(
  "Search for information about TypeScript generics and save it to a file",
  {
    maxToolsPerRequest: 4,
    enableKeywordMatching: true,
  }
);

console.log('Tool usage stats:', result.toolUsageCount);

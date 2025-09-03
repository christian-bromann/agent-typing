import { z } from 'zod';
import { createMiddleware, createAgent } from '../agent.js';

/**
 * Simple usage tracking middleware that tracks:
 * - Total tokens used (input/output)
 * - Number of model calls
 * - Tool call frequency
 */
export const usageTrackingMiddleware = createMiddleware({
  name: 'UsageTrackingMiddleware',
  stateSchema: z.object({
    usage: z.object({
      totalInputTokens: z.number().default(0),
      totalOutputTokens: z.number().default(0),
      modelCalls: z.number().default(0),
      toolCalls: z.record(z.string(), z.number()).default({}),
    }).default({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      modelCalls: 0,
      toolCalls: {},
    }),
  }),
  beforeModel: (state, runtime, controls) => {
    // Increment model call counter
    return {
      usage: {
        ...state.usage,
        modelCalls: state.usage.modelCalls + 1,
      }
    };
  },
  afterModel: (state, runtime, controls) => {
    // Update token usage
    const updatedUsage = {
      ...state.usage,
      totalInputTokens: state.usage.totalInputTokens + runtime.tokenUsage.inputTokens,
      totalOutputTokens: state.usage.totalOutputTokens + runtime.tokenUsage.outputTokens,
    };
    
    // Track tool calls
    const toolCallCounts = { ...state.usage.toolCalls };
    for (const toolCall of runtime.toolCalls) {
      toolCallCounts[toolCall.name] = (toolCallCounts[toolCall.name] || 0) + 1;
    }
    
    // Log current usage
    console.log(`[Usage] Model call #${updatedUsage.modelCalls}`);
    console.log(`[Usage] Tokens - Input: ${runtime.tokenUsage.inputTokens}, Output: ${runtime.tokenUsage.outputTokens}`);
    console.log(`[Usage] Total - Input: ${updatedUsage.totalInputTokens}, Output: ${updatedUsage.totalOutputTokens}`);
    
    if (runtime.toolCalls.length > 0) {
      console.log(`[Usage] Tool calls:`, runtime.toolCalls.map(tc => tc.name).join(', '));
    }
    
    return {
      usage: {
        ...updatedUsage,
        toolCalls: toolCallCounts,
      }
    };
  },
});

// Example usage
const trackingAgent = createAgent({
  middlewares: [usageTrackingMiddleware] as const
});

// Run the agent
const result = await trackingAgent.invoke(
  'Calculate the sum of 123 and 456, then search for information about AI'
);

// Access usage statistics from the result
console.log('\n=== Final Usage Statistics ===');
console.log(`Total model calls: ${result.usage.modelCalls}`);
console.log(`Total input tokens: ${result.usage.totalInputTokens}`);
console.log(`Total output tokens: ${result.usage.totalOutputTokens}`);
console.log(`Total tokens: ${result.usage.totalInputTokens + result.usage.totalOutputTokens}`);
console.log(`Tool usage:`, result.usage.toolCalls);

import { z } from 'zod';
import { defineMiddleware } from '../agent.js';

/**
 * Middleware that terminates after a specific tool is called 5 times
 */
export const toolCallLimitMiddleware = defineMiddleware({
  name: 'ToolCallLimitMiddleware',
  stateSchema: z.object({
    toolCallCount: z.record(z.string(), z.number()).default({}),
  }),
  contextSchema: z.object({
    toolCallLimitation: z.array(z.object({
      targetTool: z.string(),
      maxCalls: z.number().default(5),
    })),
  }),
  afterModel: (state, runtime, controls) => {
    // Check if the model made any tool calls
    const toolCalls = runtime.toolCalls;
    const { targetTool, maxCalls } = runtime.context.toolCallLimitation.find(
        limitation => limitation.targetTool === toolCalls[0]?.name
    ) || {};
    
    // Count calls to the target tool
    const updatedCounts = { ...state.toolCallCount };
    for (const call of toolCalls) {
      if (call.name === targetTool) {
        updatedCounts[targetTool] = (updatedCounts[targetTool] || 0) + 1;
      }
    }
    
    // Check if limit reached
    const count = targetTool ? updatedCounts[targetTool] ?? 0 : 0;
    if (maxCalls && count >= maxCalls) {
      return controls.terminate({
        messages: state.messages,
        toolCallCount: updatedCounts,
      });
    }
    
    // Update state with new counts
    return { toolCallCount: updatedCounts };
  },
});

/**
 * Middleware that terminates after 10 model requests
 */
export const modelRequestLimitMiddleware = defineMiddleware({
  name: 'ModelRequestLimitMiddleware',
  stateSchema: z.object({
    modelRequestCount: z.number().default(0),
  }),
  contextSchema: z.object({
    maxRequests: z.number().default(10),
  }),
  beforeModel: (state, runtime, controls) => {
    const newCount = state.modelRequestCount + 1;
    
    // Check if limit reached
    if (newCount > runtime.context.maxRequests) {
      return controls.terminate({
        messages: state.messages,
        modelRequestCount: state.modelRequestCount,
      });
    }
    
    // Update count
    return { modelRequestCount: newCount };
  },
});

// Example usage
import { createAgent } from '../agent.js';

// Example 1: Using tool call limit middleware
const toolLimitAgent = createAgent({
  middlewares: [toolCallLimitMiddleware] as const
});

// Will terminate after 'search' tool is called 5 times
const result1 = await toolLimitAgent.invoke(
  'Search for information repeatedly',
  {
    toolCallLimitation: [{
        targetTool: 'search',
        maxCalls: 5
    }, {
        targetTool: 'calculator',
        maxCalls: 5
    }]
  }
);

// Example 2: Using model request limit middleware  
const modelLimitAgent = createAgent({
  middlewares: [modelRequestLimitMiddleware] as const
});

// Will terminate after 10 model requests
const result2 = await modelLimitAgent.invoke(
  'Have a long conversation',
  { maxRequests: 10 }
);

// Example 3: Using both middlewares together
const combinedAgent = createAgent({
  middlewares: [toolCallLimitMiddleware, modelRequestLimitMiddleware] as const
});

// Will terminate when either limit is reached
const result3 = await combinedAgent.invoke(
  'Complex task with tool usage',
  { 
    toolCallLimitation: [{
        targetTool: 'calculator',
        maxCalls: 5
    }],
    maxRequests: 10
  }
);

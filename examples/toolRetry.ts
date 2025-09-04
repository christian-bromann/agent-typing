import { z } from 'zod';
import { tool } from "langchain";
import { createMiddleware, createAgent, BaseMessage, ToolResult } from '../agent.js';

/**
 * Three different error handling strategies for tool errors
 */

/**
 * Strategy 1: Jump back to model with AI message to fix arguments
 */
export const aiFixArgumentsMiddleware = createMiddleware({
  name: 'AIFixArgumentsMiddleware',
  stateSchema: z.object({
    errorAttempts: z.record(z.string(), z.number()).default({}),
  }),
  
  contextSchema: z.object({
    maxRetries: z.number().default(2),
  }),
  
  afterModel: async (state, runtime, controls) => {
    const toolErrors = runtime.toolResults.filter(tr => tr.error);
    
    for (const toolError of toolErrors) {
      const toolCall = runtime.toolCalls.find(tc => tc.id === toolError.id);
      if (!toolCall) continue;
      
      const attempts = state.errorAttempts[toolCall.id] || 0;
      if (attempts >= runtime.context.maxRetries) continue;
      
      // Check if it's an argument validation error
      if (toolError.error?.includes('Invalid') || 
          toolError.error?.includes('Expected') ||
          toolError.error?.includes('Required')) {
        
        // Jump back to model with an AI message guiding the fix
        return controls.jumpTo('model', {
          errorAttempts: {
            ...state.errorAttempts,
            [toolCall.id]: attempts + 1,
          },
          messages: [
            ...state.messages,
            new BaseMessage('assistant', 
              `I encountered an error with the ${toolCall.name} tool. ` +
              `Let me fix the arguments and try again.`
            ),
            new BaseMessage('system',
              `Tool validation error: ${toolError.error}\n\n` +
              `Previous arguments that failed:\n${JSON.stringify(toolCall.args, null, 2)}\n\n` +
              `Please call the tool again with corrected arguments.`
            )
          ]
        });
      }
    }
    
    return undefined;
  },
});

/**
 * Strategy 2: Jump back to tools node with updated arguments
 */
export const autoFixArgumentsMiddleware = createMiddleware({
  name: 'AutoFixArgumentsMiddleware',
  stateSchema: z.object({
    fixedCalls: z.record(z.string(), z.boolean()).default({}),
  }),
  
  afterModel: async (state, runtime, controls) => {
    const toolErrors = runtime.toolResults.filter(tr => tr.error);
    
    for (const toolError of toolErrors) {
      const toolCall = runtime.toolCalls.find(tc => tc.id === toolError.id);
      if (!toolCall || state.fixedCalls[toolCall.id]) continue;
      
      // Auto-fix common errors
      let fixedArgs = { ...toolCall.args };
      let canAutoFix = false;
      
      // Example: Fix missing required fields
      if (toolError.error?.includes('Required field')) {
        const fieldMatch = toolError.error.match(/field[s]? (.+) (?:is|are) required/i);
        if (fieldMatch && fieldMatch[1]) {
          const fields = fieldMatch[1].split(',').map(f => f.trim());
          for (const field of fields) {
            if (field === 'email') {
              fixedArgs.email = 'user@example.com';
              canAutoFix = true;
            } else if (field === 'notifications') {
              fixedArgs.notifications = true;
              canAutoFix = true;
            }
          }
        }
      }
      
      // Example: Fix enum values
      if (toolError.error?.includes('Expected one of')) {
        const enumMatch = toolError.error.match(/Expected one of \[(.+)\]/);
        if (enumMatch && enumMatch[1]) {
          const validValues = enumMatch[1].split(',').map(v => v.trim().replace(/['"]/g, ''));
          const fieldMatch = toolError.error.match(/for field (\w+)/);
          if (fieldMatch && fieldMatch[1] && validValues.length > 0) {
            fixedArgs[fieldMatch[1]] = validValues[0];
            canAutoFix = true;
          }
        }
      }
      
      if (canAutoFix) {
        // Store that we've fixed this call
        // Note: We can't directly modify toolCalls in state, we need to handle this differently
        // For now, we'll jump back to model with instructions to retry with fixed args
        return controls.jumpTo('model', {
          fixedCalls: {
            ...state.fixedCalls,
            [toolCall.id]: true,
          },
          messages: [
            ...state.messages,
            new BaseMessage('system',
              `Tool ${toolCall.name} failed. Please retry with these corrected arguments:\n` +
              `${JSON.stringify(fixedArgs, null, 2)}`
            )
          ]
        });
      }
    }
    
    return undefined;
  },
});

/**
 * Strategy 3: Jump back to model requesting tool rerun with error context
 */
export const retryWithContextMiddleware = createMiddleware({
  name: 'RetryWithContextMiddleware',
  stateSchema: z.object({
    retryHistory: z.array(z.object({
      toolName: z.string(),
      error: z.string(),
      timestamp: z.number(),
    })).default([]),
  }),
  
  contextSchema: z.object({
    includeErrorDetails: z.boolean().default(true),
  }),
  
  afterModel: async (state, runtime, controls) => {
    const toolErrors = runtime.toolResults.filter(tr => tr.error);
    
    for (const toolError of toolErrors) {
      const toolCall = runtime.toolCalls.find(tc => tc.id === toolError.id);
      if (!toolCall) continue;
      
      // Check if it's a recoverable error (network, temporary failures)
      if (toolError.error?.includes('Network') || 
          toolError.error?.includes('timeout') ||
          toolError.error?.includes('temporarily')) {
        
        const errorDetails = runtime.context.includeErrorDetails 
          ? `\n\nError details: ${toolError.error}\nOriginal arguments: ${JSON.stringify(toolCall.args, null, 2)}`
          : '';
        
        // Jump back to model with retry request
        return controls.jumpTo('model', {
          retryHistory: [
            ...state.retryHistory,
            {
              toolName: toolCall.name,
              error: toolError.error || 'Unknown error',
              timestamp: Date.now(),
            }
          ],
          messages: [
            ...state.messages,
            new BaseMessage('system',
              `The ${toolCall.name} tool encountered an error. ` +
              `Please try calling it again as the issue might be temporary.${errorDetails}`
            )
          ]
        });
      }
    }
    
    return undefined;
  },
});

// Tool 1: User profile tool with strict validation
const updateUserProfile = tool(
  async (input) => {
    const { userId, age, email, preferences } = input as {
      userId: string;
      age: number;
      email: string;
      preferences: { theme: 'light' | 'dark'; notifications: boolean };
    };
    // Simulate profile update
    return { 
      success: true, 
      updated: { userId, age, email, preferences },
      timestamp: new Date().toISOString()
    };
  },
  {
    name: 'updateUserProfile',
    description: 'Update user profile with validated data',
    schema: z.object({
      userId: z.string().uuid(),
      age: z.number().min(18).max(120),
      email: z.string().email(),
      preferences: z.object({
        theme: z.enum(['light', 'dark']),
        notifications: z.boolean(),
      }),
    }),
  }
);

// Tool 2: Data processor that might encounter runtime errors
const processUserData = tool(
  async (input) => {
    const { data } = input as { data: any };
    // This might throw if data structure is unexpected
    try {
      const result = data.user.profile.settings.value;
      return { processed: result, status: 'success' };
    } catch (error: any) {
      throw new Error(`Cannot read properties: ${error.message}`);
    }
  },
  {
    name: 'processUserData',
    description: 'Process nested user data structures',
    schema: z.object({
      data: z.any(),
    }),
  }
);

// Tool 3: Weather service that might have network issues
const getWeather = tool(
  async (input) => {
    const { city } = input as { city: string };
    // Simulate network issues 40% of the time
    if (Math.random() < 0.4) {
      throw new Error('Network timeout: Unable to reach weather service');
    }
    
    return { 
      city,
      temperature: Math.floor(Math.random() * 30) + 50,
      condition: ['sunny', 'cloudy', 'rainy'][Math.floor(Math.random() * 3)],
      humidity: Math.floor(Math.random() * 40) + 40,
    };
  },
  {
    name: 'getWeather',
    description: 'Get current weather for a city',
    schema: z.object({
      city: z.string().min(1),
    }),
  }
);

// Example 1: AI Fix Arguments Middleware
console.log('=== Example 1: AI Fix Arguments Strategy ===');
const agent1 = createAgent({
  middlewares: [aiFixArgumentsMiddleware] as const,
  tools: [updateUserProfile],
});

const result1 = await agent1.invoke(
  {
    messages: [new BaseMessage('user', 'Update profile for user with ID "not-a-uuid", age 15, email "invalid-email"')],
  },
  { maxRetries: 2 }
);
console.log('AI Fix Result - Attempts:', result1.errorAttempts);

// Example 2: Auto Fix Arguments Middleware  
console.log('\n=== Example 2: Auto Fix Arguments Strategy ===');
const agent2 = createAgent({
  middlewares: [autoFixArgumentsMiddleware] as const,
  tools: [updateUserProfile],
});

const result2 = await agent2.invoke(
  {
    messages: [new BaseMessage('user', 'Update user 550e8400-e29b-41d4-a716-446655440000 with age 25 and theme "blue"')],
  },
  {}
);
console.log('Auto Fix Result - Fixed calls:', result2.fixedCalls);

// Example 3: Retry with Context Middleware
console.log('\n=== Example 3: Retry with Context Strategy ===');
const agent3 = createAgent({
  middlewares: [retryWithContextMiddleware] as const,
  tools: [getWeather],
});

const result3 = await agent3.invoke(
  {
    messages: [new BaseMessage('user', 'What is the weather in New York?')],
  },
  { includeErrorDetails: true }
);
console.log('Retry Context Result - History:', result3.retryHistory.length, 'attempts');

// Example 4: Combined middlewares for complex scenarios
console.log('\n=== Example 4: Combined Strategies ===');
const agent4 = createAgent({
  middlewares: [aiFixArgumentsMiddleware, retryWithContextMiddleware] as const,
  tools: [updateUserProfile, processUserData, getWeather],
});

const result4 = await agent4.invoke(
  {
    messages: [new BaseMessage('user', 'Update user profile and check the weather in their city')],
  },
  { maxRetries: 2, includeErrorDetails: true }
);
console.log('Combined Result - Errors handled:', Object.keys(result4.errorAttempts).length);
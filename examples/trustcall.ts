import { z } from 'zod';
import { createMiddleware, createAgent, BaseMessage, ToolCall, ToolResult, Controls } from '../agent.js';

/**
 * JSON Patch operation types based on RFC 6902
 */
interface JsonPatchOp {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: any;
  from?: string;
}

/**
 * Apply JSON patches to an object
 */
function applyJsonPatches(target: any, patches: JsonPatchOp[]): any {
  let result = JSON.parse(JSON.stringify(target)); // Deep clone
  
  for (const patch of patches) {
    const pathParts = patch.path.split('/').filter(p => p !== '');
    
    switch (patch.op) {
      case 'add':
      case 'replace': {
        let current = result;
        for (let i = 0; i < pathParts.length - 1; i++) {
          const key = pathParts[i];
          if (key && !(key in current)) {
            current[key] = {};
          }
          if (key) {
            current = current[key];
          }
        }
        const lastKey = pathParts[pathParts.length - 1];
        if (lastKey) {
          current[lastKey] = patch.value;
        }
        break;
      }
      case 'remove': {
        let current = result;
        for (let i = 0; i < pathParts.length - 1; i++) {
          const key = pathParts[i];
          if (key && current) {
            current = current[key];
          }
          if (!current) break;
        }
        const lastKey = pathParts[pathParts.length - 1];
        if (current && lastKey) {
          delete current[lastKey];
        }
        break;
      }
      // Simplified implementation - extend as needed
    }
  }
  
  return result;
}

/**
 * Trustcall Middleware - Provides reliable structured output generation using JSON patches
 * 
 * Features:
 * - Handles validation errors by prompting for JSON patches
 * - Supports updating existing schemas without data loss
 * - Enables iterative refinement of complex nested structures
 * - Reduces costs by only regenerating the parts that failed
 */
export const trustcallMiddleware = createMiddleware({
  name: 'TrustcallMiddleware',
  stateSchema: z.object({
    // Track validation errors and patches
    validationAttempts: z.array(z.object({
      toolCallId: z.string(),
      toolName: z.string(),
      attempt: z.number(),
      error: z.string(),
      patches: z.array(z.any()).optional(),
      success: z.boolean(),
    })).default([]),
    
    // Track existing data for updates
    existingData: z.record(z.string(), z.any()).default({}),
    
    // Current retry state
    retryState: z.object({
      isRetrying: z.boolean(),
      toolCallId: z.string().optional(),
      currentAttempt: z.number(),
    }).default({ isRetrying: false, currentAttempt: 0 }),
  }),
  
  contextSchema: z.object({
    // Maximum retry attempts for validation errors
    maxRetries: z.number().default(3),
    // Enable verbose logging
    verbose: z.boolean().default(false),
    // Initial existing data to update (tool_name -> data)
    existing: z.record(z.string(), z.any()).optional(),
    // Tool schemas for validation (tool_name -> zod schema)
    toolSchemas: z.record(z.string(), z.any()).optional(),
  }),
  
  prepareCall: (options, state, runtime) => {
    // If we're retrying a validation error, modify the prompt
    if (state.retryState.isRetrying && state.retryState.toolCallId) {
      const lastAttempt = state.validationAttempts
        .filter(a => a.toolCallId === state.retryState.toolCallId)
        .pop();
      
      if (lastAttempt) {
        // Create a system message for patch generation
        const patchPrompt = `The previous tool call failed validation with error:
${lastAttempt.error}

Tool: ${lastAttempt.toolName}
Original arguments: ${JSON.stringify(runtime.toolCalls.find(tc => tc.id === lastAttempt.toolCallId)?.args)}

Please generate a JSON Patch (RFC 6902) to fix this validation error. Return ONLY the JSON patch operations needed to fix the error.

Example patch format:
[
  { "op": "add", "path": "/missing_field", "value": "default_value" },
  { "op": "replace", "path": "/invalid_field", "value": "corrected_value" }
]`;

        return {
          ...options,
          messages: [
            ...state.messages,
            new BaseMessage('system', patchPrompt)
          ],
          toolChoice: 'none', // Don't call tools when generating patches
        };
      }
    }
    
    // If we have existing data, include it in the context
    if (runtime.context.existing || Object.keys(state.existingData).length > 0) {
      const existingData = { ...runtime.context.existing, ...state.existingData };
      const dataContext = Object.entries(existingData)
        .map(([toolName, data]) => `Existing ${toolName} data:\n${JSON.stringify(data, null, 2)}`)
        .join('\n\n');
      
      if (dataContext) {
        const systemMessage = options.systemMessage || '';
        return {
          ...options,
          systemMessage: `${systemMessage}\n\nWhen updating existing data, generate JSON patches instead of full replacements to preserve information:\n${dataContext}`,
        };
      }
    }
    
    return options;
  },
  
  afterModel: async (state, runtime, controls) => {
    // Check if we're in patch generation mode
    if (state.retryState.isRetrying) {
      const lastMessage = state.messages.at(-1);
      
      if (lastMessage && lastMessage.role === 'assistant') {
        try {
          // Extract JSON patch from response
          const patchMatch = lastMessage.content.match(/\[[\s\S]*\]/);
          if (patchMatch) {
            const patches = JSON.parse(patchMatch[0]) as JsonPatchOp[];
            
            // Apply patches to the failed tool call
            const failedCall = runtime.toolCalls.find(tc => tc.id === state.retryState.toolCallId);
            if (failedCall) {
              const patchedArgs = applyJsonPatches(failedCall.args, patches);
              
              // Validate if we have schemas
              if (runtime.context.toolSchemas && runtime.context.toolSchemas[failedCall.name]) {
                try {
                  const schema = runtime.context.toolSchemas[failedCall.name];
                  schema.parse(patchedArgs);
                  
                  // Success! Update the tool call
                  const updatedCalls = runtime.toolCalls.map(tc => 
                    tc.id === failedCall.id ? { ...tc, args: patchedArgs } : tc
                  );
                  
                  return {
                    validationAttempts: [
                      ...state.validationAttempts,
                      {
                        toolCallId: failedCall.id,
                        toolName: failedCall.name,
                        attempt: state.retryState.currentAttempt,
                        error: '',
                        patches,
                        success: true,
                      }
                    ],
                    retryState: { isRetrying: false, currentAttempt: 0 },
                  };
                } catch (e: any) {
                  // Still failing, maybe retry
                  if (state.retryState.currentAttempt < runtime.context.maxRetries) {
                    return controls.retry({
                      validationAttempts: [
                        ...state.validationAttempts,
                        {
                          toolCallId: failedCall.id,
                          toolName: failedCall.name,
                          attempt: state.retryState.currentAttempt,
                          error: e.message,
                          patches,
                          success: false,
                        }
                      ],
                      retryState: {
                        isRetrying: true,
                        toolCallId: failedCall.id,
                        currentAttempt: state.retryState.currentAttempt + 1,
                      }
                    });
                  }
                }
              }
            }
          }
        } catch (e) {
          // Failed to parse patches
          if (runtime.context.verbose) {
            console.error('Failed to parse JSON patches:', e);
          }
        }
      }
      
      // Reset retry state if we couldn't handle it
      return {
        retryState: { isRetrying: false, currentAttempt: 0 },
      };
    }
    
    // Check tool results for validation errors
    const toolErrors = runtime.toolResults.filter(tr => tr.error);
    
    for (const toolError of toolErrors) {
      const toolCall = runtime.toolCalls.find(tc => tc.id === toolError.id);
      if (!toolCall) continue;
      
      // Check if this is a validation error (simple heuristic)
      if (toolError.error?.includes('validation') || 
          toolError.error?.includes('required') ||
          toolError.error?.includes('invalid')) {
        
        // Start retry process
        return controls.retry({
          validationAttempts: [
            ...state.validationAttempts,
            {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              attempt: 0,
              error: toolError.error,
              success: false,
            }
          ],
          retryState: {
            isRetrying: true,
            toolCallId: toolCall.id,
            currentAttempt: 1,
          }
        }, {
          reason: `Validation error in ${toolCall.name}: ${toolError.error}`,
          maxAttempts: runtime.context.maxRetries,
        });
      }
    }
    
    return undefined;
  },
});

// Example: Complex nested schema that often fails with naive extraction
const UserPreferencesSchema = z.object({
  communication: z.object({
    email: z.object({
      frequency: z.enum(['daily', 'weekly', 'monthly']),
      types: z.array(z.string()),
    }),
    sms: z.object({
      enabled: z.boolean(),
      number: z.string().optional(),
    }),
  }),
  privacy: z.object({
    profileVisibility: z.enum(['public', 'friends', 'private']),
    dataSharing: z.boolean(),
  }),
});

// Example usage
const agent = createAgent({
  contextSchema: z.object({
    task: z.string(),
  }),
  middlewares: [trustcallMiddleware] as const,
});

// Example 1: Extraction with validation retry
const extractionResult = await agent.invoke(
  `Extract user preferences from this conversation:
  User: I'd like to get weekly email updates about new features and security alerts.
  Support: Sure! Should we enable SMS notifications too?
  User: No thanks, email is fine. And please keep my profile private.`,
  {
    task: 'extract_preferences',
    maxRetries: 3,
    toolSchemas: {
      'update_preferences': UserPreferencesSchema,
    },
  }
);

// Example 2: Updating existing data without loss
const updateResult = await agent.invoke(
  `Update the preferences based on: User wants daily emails now and enabled data sharing.`,
  {
    task: 'update_preferences',
    existing: {
      'UserPreferences': {
        communication: {
          email: { frequency: 'weekly', types: ['features', 'security'] },
          sms: { enabled: false }
        },
        privacy: {
          profileVisibility: 'private',
          dataSharing: false
        }
      }
    },
    verbose: true,
  }
);

console.log('Extraction attempts:', extractionResult.validationAttempts);
console.log('Update result:', updateResult.existingData);

import { z } from 'zod';
import { defineMiddleware, BaseMessage } from '../agent.js';

/**
 * Trimming middleware - keeps conversation history within limits
 */
export const trimmingMiddleware = defineMiddleware({
  name: 'TrimmingMiddleware',
  stateSchema: z.object({
    // State could track things like how many times we've trimmed
    trimCount: z.number().default(0),
  }),
  contextSchema: z.object({
    // Configuration options provided by the user
    maxMessages: z.number().default(10),
    maxTokensPerMessage: z.number().default(500),
  }),
  prepareCall: (options, state, runtime) => {
    // Trim messages to keep only the most recent ones
    const messages = options.messages || state.messages;
    const trimmedMessages = messages.slice(-runtime.context.maxMessages);
    
    // Optionally trim each message content to max tokens (simplified char count)
    const finalMessages = trimmedMessages.map(msg => ({
      ...msg,
      content: msg.content.substring(0, runtime.context.maxTokensPerMessage)
    }));
    
    return {
      ...options,
      messages: finalMessages
    };
  }
});

// Example usage
import { createAgent } from '../agent.js';

const agent = createAgent({
  middlewares: [trimmingMiddleware] as const
});

// Example usage
const result = await agent.invoke(
  'Hello, this is a long conversation that will be trimmed'
);
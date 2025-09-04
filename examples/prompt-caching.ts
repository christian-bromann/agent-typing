import { z } from 'zod';
import { createMiddleware, createAgent, BaseMessage } from '../agent.js';

// Extend BaseMessage type to include cache_control
interface CachedMessage extends BaseMessage {
  cache_control?: {
    type: 'ephemeral';
    ttl: '5m' | '1h';
  };
}

/**
 * Prompt Caching Middleware - Optimizes API usage by caching conversation prefixes
 * 
 * This middleware adds cache_control blocks to messages to enable Anthropic's
 * prompt caching feature, reducing costs and latency for repetitive prompts.
 */
export const promptCachingMiddleware = createMiddleware({
  name: 'PromptCachingMiddleware',
  stateSchema: z.object({
    // Track cache usage for monitoring
    cacheHits: z.number().default(0),
    cacheWrites: z.number().default(0),
    lastCachePoint: z.number().default(0),
  }),
  contextSchema: z.object({
    // Configuration options
    enableCaching: z.boolean().default(true),
    cacheTTL: z.enum(['5m', '1h']).default('5m'),
    minMessagesToCache: z.number().default(3),
    cacheSystemMessages: z.boolean().default(true),
  }),
  prepareCall: (options, state, runtime) => {
    // Skip if caching is disabled
    if (!runtime.context.enableCaching) {
      return undefined;
    }

    const messages = options.messages || state.messages;
    
    // Only cache if we have enough messages
    if (messages.length < runtime.context.minMessagesToCache) {
      return undefined;
    }

    // Clone messages to avoid mutation and cast to CachedMessage
    const cachedMessages: CachedMessage[] = messages.map(msg => ({ ...msg }));
    
    // Add cache control to system messages if enabled
    let systemMessageCached = false;
    if (runtime.context.cacheSystemMessages) {
      for (let i = 0; i < cachedMessages.length; i++) {
        const message = cachedMessages[i];
        if (message && message.role === 'system') {
          // Add cache_control to the last system message
          message.cache_control = { 
            type: 'ephemeral',
            ttl: runtime.context.cacheTTL 
          };
          systemMessageCached = true;
        }
      }
    }

    // Find the best point to cache conversation history
    // Cache at the end of the second-to-last user message for incremental caching
    let cachePointIndex = -1;
    let userMessageCount = 0;
    
    for (let i = cachedMessages.length - 1; i >= 0; i--) {
      const message = cachedMessages[i];
      if (message && message.role === 'user') {
        userMessageCount++;
        if (userMessageCount === 2) {
          cachePointIndex = i;
          break;
        }
      }
    }

    // If we found a good cache point, add cache control
    if (cachePointIndex > 0) {
      const cacheMessage = cachedMessages[cachePointIndex];
      if (cacheMessage) {
        cacheMessage.cache_control = { 
          type: 'ephemeral',
          ttl: runtime.context.cacheTTL 
        };
      }
    }

    // Add system message if provided in options
    if (options.systemMessage && runtime.context.cacheSystemMessages) {
      const systemMsg: CachedMessage = new BaseMessage('system', options.systemMessage) as CachedMessage;
      systemMsg.cache_control = { 
        type: 'ephemeral',
        ttl: runtime.context.cacheTTL 
      };
      cachedMessages.unshift(systemMsg);
    }

    return {
      ...options,
      messages: cachedMessages,
    };
  },
  afterModel: async (state, runtime) => {
    // In a real implementation, you would check the response for cache metrics
    // For this example, we'll simulate tracking cache usage
    const wasCacheHit = state.messages.length > runtime.context.minMessagesToCache;
    
    if (wasCacheHit) {
      return {
        cacheHits: state.cacheHits + 1,
        lastCachePoint: state.messages.length,
      };
    } else {
      return {
        cacheWrites: state.cacheWrites + 1,
        lastCachePoint: state.messages.length,
      };
    }
  },
});

// Example usage
const agent = createAgent({
  middlewares: [promptCachingMiddleware] as const,
});

// Usage example with caching enabled
const result = await agent.invoke(
  {
    messages: [new BaseMessage('user', "What are the key features of prompt caching?")],
  },
  {
    enableCaching: true,
    cacheTTL: '5m',
    minMessagesToCache: 2,
    cacheSystemMessages: true,
  }
);

console.log('Cache hits:', result.cacheHits);
console.log('Cache writes:', result.cacheWrites);
console.log('Last cache point:', result.lastCachePoint);

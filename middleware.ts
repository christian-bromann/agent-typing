import { z } from 'zod';
import {
  createMiddleware,
  ToolMessage,
  AIMessage,
  AssistantMessage,
} from './agent.js';

export const middlewareA = createMiddleware({
  name: 'MiddlewareA',
  stateSchema: z.object({
    customStateA: z.boolean().default(false),
  }),
  contextSchema: z.object({
    customContextA: z.boolean(),
  }),
  beforeModel: (state, runtime, controls) => {
    console.log('customStateA value:', state.customStateA);
    console.log('built-in state properties', state.messages);
    console.log('built-in runtime properties', runtime.context.customContextA);

    /**
     * jump to tool node with new tool call message
     */
    return controls.jumpTo("tools", {
        messages: [
            ...state.messages,
            new ToolMessage('user', 'tool call'),
        ],
    });
  },
  afterModel: (state, runtime, controls) => {
    console.log('customStateA value:', state.customStateA);
    console.log('built-in state properties', state.messages);
    console.log('built-in runtime properties', runtime.context.customContextA);
    
    /**
     * make a model with new assistant message
     */
    return controls.jumpTo("model", {
        messages: [
            ...state.messages,
            new AssistantMessage('assistant', 'assistant message'),
        ],
    });
  },
});

export const middlewareB = createMiddleware({
  name: 'MiddlewareB',
  stateSchema: z.object({
    customStateB: z.enum(['a', 'b', 'c']).default('a'),
  }),
  contextSchema: z.object({
    customContextB: z.number(),
  }),
  beforeModel: async (state, runtime, controls) => {
    console.log('customStateB value:', state.customStateB);
    console.log('built-in state properties', state.messages);
    console.log('built-in runtime properties', runtime.context.customContextB);

    /**
     * return result to `.invoke()`
     */
    return controls.terminate({
        messages: [
            ...state.messages,
            new AIMessage('assistant', 'assistant message'),
        ],
    });
  },
  afterModel: async (state, runtime, controls) => {
    console.log('customStateB value:', state.customStateB);
    console.log('built-in state properties', state.messages);
    console.log('built-in runtime properties', runtime.context.customContextB);

    /**
     * throw an error to `.invoke()`
     */
    return controls.terminate(new Error('middleware B terminated'));
  },
});

export const middlewareC = createMiddleware({
  name: 'MiddlewareC',
  stateSchema: z.object({
    customStateC: z.number().default(0),
  }),
  contextSchema: z.object({
    customContextC: z.enum(['a', 'b', 'c']),
  }),
  prepareCall: (options, state, runtime) => {
    console.log('MiddlewareC prepareCall');
    console.log('Current model:', options.model);
    console.log('Context value:', runtime.context.customContextC);
    
    // Example: Add a system message based on context
    if (runtime.context.customContextC === 'a') {
      return {
        ...options,
        systemMessage: 'You are in mode A. Be extra helpful.',
      };
    }
    
    // Return undefined to pass through unchanged
    return undefined;
  },
  beforeModel: async (state, runtime) => {
    console.log('customStateC value:', state.customStateC);
    console.log('built-in state properties', state.messages);
    console.log('built-in runtime properties', runtime.context.customContextC);
  },
  afterModel: async (state, runtime) => {
    console.log('customStateC value:', state.customStateC);
    console.log('built-in state properties', state.messages);
    console.log('built-in runtime properties', runtime.context.customContextC);
  },
});

export const middlewareD = createMiddleware({
  name: 'middlewareD',
  beforeModel: async (state, runtime) => {
    console.log('MiddlewareD beforeModel');
    console.log('built-in state properties', state.messages);
  },
});
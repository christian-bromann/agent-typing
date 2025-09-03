import { z } from 'zod';
import { defineMiddleware, createAgent, BaseMessage } from '../agent.js';

/**
 * Simple Swarm Middleware Example
 * 
 * This demonstrates a minimal swarm pattern with just coordinator and worker agents
 */

// Define the swarm middleware
export const simpleSwarmMiddleware = defineMiddleware({
  name: 'SimpleSwarm',
  
  stateSchema: z.object({
    activeAgent: z.string().default('coordinator'),
    taskCompleted: z.boolean().default(false)
  }),
  
  prepareCall: (options, state) => {
    // Set system message based on active agent
    if (state.activeAgent === 'coordinator') {
      return {
        ...options,
        systemMessage: `You are the Coordinator. Analyze tasks and delegate to workers by saying "DELEGATE_TO: worker_name".`
      };
    } else {
      return {
        ...options,
        systemMessage: `You are Worker ${state.activeAgent}. Complete the assigned task and say "TASK_COMPLETE" when done.`
      };
    }
  },
  
  afterModel: async (state, _, controls) => {
    const lastMessage = state.messages.at(-1);
    const content = lastMessage?.content || '';
    
    // Check for delegation
    if (content.includes('DELEGATE_TO:')) {
      const match = content.match(/DELEGATE_TO:\s*(\w+)/);
      if (match && match[1]) {
        const workerName = match[1];
        console.log(`🤝 Delegating to ${workerName}`);
        return controls.jumpTo('model', {
          activeAgent: workerName
        });
      }
    }
    
    // Check for task completion
    if (content.includes('TASK_COMPLETE')) {
      console.log('✅ Task completed by', state.activeAgent);
      return controls.terminate({ 
        ...state, 
        taskCompleted: true 
      });
    }
  }
});

// Example usage
const agent = createAgent({
middlewares: [simpleSwarmMiddleware] as const
});

const result = await agent.invoke("Analyze this sentence for grammar and fix any issues: 'The cat are sleeping on the couch.'");

console.log('Final state:', {
    activeAgent: result.activeAgent,
    taskCompleted: result.taskCompleted,
    messageCount: result.messages.length
});

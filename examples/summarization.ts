import { z } from 'zod';
import { defineMiddleware, createAgent, BaseMessage } from '../agent.js';

// Simple summarization middleware that summarizes long conversations
export const summarizationMiddleware = defineMiddleware({
  name: 'SummarizationMiddleware',
  stateSchema: z.object({
    messageCount: z.number().default(0),
    lastSummary: z.string().optional(),
  }),
  contextSchema: z.object({
    maxMessagesBeforeSummary: z.number().default(10),
  }),
  beforeModel: async (state, runtime, controls) => {
    const messageCount = state.messages.length;
    
    // Check if we need to summarize
    if (messageCount > runtime.context.maxMessagesBeforeSummary) {
      // Create a simple summary of the conversation
      const summary = `Previous conversation summary: ${messageCount} messages exchanged.`;
      
      // Keep only the last few messages plus the summary
      const recentMessages = state.messages.slice(-3);
      const summaryMessage = new BaseMessage('system', summary);
      
      return {
        messages: [summaryMessage, ...recentMessages],
        messageCount: recentMessages.length + 1,
        lastSummary: summary,
      };
    }
    
    // Update message count
    return {
      messageCount,
    };
  },
});

// Example usage
const agent = createAgent({
  contextSchema: z.object({
    userId: z.string(),
  }),
  middlewares: [summarizationMiddleware] as const,
});

// Usage example (commented out to avoid execution)
const result = await agent.invoke("Tell me about AI", {
  userId: "user123",
  maxMessagesBeforeSummary: 5, // Summarize after 5 messages
});

console.log('Message count:', result.messageCount);
console.log('Last summary:', result.lastSummary);

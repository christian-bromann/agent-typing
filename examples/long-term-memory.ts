import { z } from 'zod';
import { InMemoryStore } from '@langchain/core/stores';
import { createMiddleware, createAgent, AssistantMessage, BaseMessage } from '../agent.js';

// Global store instance
const memoryStore = new InMemoryStore();

/**
 * Long Term Memory Middleware
 * Enables agents to remember customer preferences and past interactions
 */
export const longTermMemoryMiddleware = createMiddleware({
    name: 'LongTermMemory',
    stateSchema: z.object({
        // Current customer memories loaded for this conversation
        currentMemories: z.object({
            preferences: z.record(z.string(), z.any()).default({}),
            pastIssues: z.array(z.string()).default([]),
            lastInteraction: z.string().optional(),
        }).default({
            preferences: {},
            pastIssues: [],
        }),
        
        // Track if memories have been loaded
        memoriesLoaded: z.boolean().default(false),
    }),
    
    contextSchema: z.object({
        // Customer ID to namespace memories
        customerId: z.string(),
        // Product/service context
        product: z.string().optional(),
    }),
    
    /**
     * Uses `prepareCall` to add customer context to the system message.
     */
    prepareCall: (options, state, runtime) => {
        // Add customer context to system message
        if (state.memoriesLoaded && state.currentMemories.preferences) {
            const preferences = Object.entries(state.currentMemories.preferences)
                .map(([key, value]) => `- ${key}: ${value}`)
                .join('\n');
            
            const systemMessage = `You are a helpful customer service agent.

Customer Information:
- Customer ID: ${runtime.context.customerId}
${state.currentMemories.lastInteraction ? `- Last interaction: ${state.currentMemories.lastInteraction}` : ''}

Customer Preferences:
${preferences || 'No preferences recorded yet.'}

${state.currentMemories.pastIssues.length > 0 ? `Past Issues:\n${state.currentMemories.pastIssues.map(issue => `- ${issue}`).join('\n')}` : ''}

Remember to:
1. Use the customer's preferred communication style
2. Reference past interactions when relevant
3. Update preferences if you learn new information`;
            
            return {
                ...options,
                systemMessage,
            };
        }
        
        return undefined;
    },
    
    /**
     * Uses `beforeModel` to load customer memories on first interaction.
     */
    beforeModel: async (state, runtime, controls) => {
        // Load customer memories on first interaction
        if (!state.memoriesLoaded) {
            const customerId = runtime.context.customerId;
            
            // Load memories using LangChain's InMemoryStore API
            const keys = [
                `customers:${customerId}:preferences`,
                `customers:${customerId}:past-issues`,
                `customers:${customerId}:last-interaction`
            ];
            const memories = await memoryStore.mget(keys);
            
            return {
                memoriesLoaded: true,
                currentMemories: {
                    preferences: memories[0] || {},
                    pastIssues: memories[1] || [],
                    lastInteraction: memories[2],
                },
            };
        }
    },
    
    /**
     * Uses `afterModel` to analyze the conversation and store new information.
     */
    afterModel: async (state, runtime, controls) => {
        // Analyze the conversation to extract and store new information
        const lastMessage = state.messages.at(-1);
        
        if (lastMessage && lastMessage.role === 'assistant') {
            const namespace = ['customers', runtime.context.customerId];
            
            // Simple pattern matching to detect preference updates
            // In production, this would use NLP or structured tool calls
            const preferencePatterns = [
                { pattern: /prefer(?:s)? to be called (\w+)/i, key: 'preferred_name' },
                { pattern: /prefer(?:s)? (\w+) communication/i, key: 'communication_style' },
                { pattern: /best time to contact.*?(\d{1,2}(?:am|pm))/i, key: 'preferred_contact_time' },
            ];
            
            let preferencesUpdated = false;
            const updatedPreferences = { ...state.currentMemories.preferences };
            
            for (const { pattern, key } of preferencePatterns) {
                const match = lastMessage.content.match(pattern);
                if (match) {
                    updatedPreferences[key] = match[1];
                    preferencesUpdated = true;
                }
            }
            
            // Store updated preferences
            if (preferencesUpdated) {
                await memoryStore.mset([[
                    `customers:${runtime.context.customerId}:preferences`,
                    updatedPreferences
                ]]);
            }
            
            // Update last interaction timestamp
            await memoryStore.mset([[
                `customers:${runtime.context.customerId}:last-interaction`,
                new Date().toISOString()
            ]]);
            
            // Detect and store new issues
            if (lastMessage.content.toLowerCase().includes('i can help you with')) {
                const issueMatch = lastMessage.content.match(/help you with (.+?)(?:\.|,|$)/i);
                if (issueMatch) {
                    const newIssue = `${new Date().toLocaleDateString()}: ${issueMatch[1]}`;
                    const updatedIssues = [...state.currentMemories.pastIssues, newIssue];
                    await memoryStore.mset([[
                        `customers:${runtime.context.customerId}:past-issues`,
                        updatedIssues
                    ]]);
                }
            }
        }
    },
});

// Pre-populate some customer data
await memoryStore.mset([
    ['customers:customer-123:preferences', {
        preferred_name: 'John',
        communication_style: 'formal',
        preferred_contact_time: '2pm',
    }],
    ['customers:customer-123:past-issues', [
        '2024-01-15: Billing inquiry',
        '2024-02-20: Password reset',
    ]],
]);

// Create agent with long-term memory
const agent = createAgent({
    middlewares: [longTermMemoryMiddleware],
});

// First interaction
console.log('First interaction:');
const result1 = await agent.invoke(
    {
        messages: [new BaseMessage('user', "Hi, I'm having trouble with my account login")],
    },
    { customerId: 'customer-123' }
);

// Simulate agent response
result1.messages.push(new AssistantMessage(
    'assistant',
    "Hello John! I can help you with your account login issue. I see you've had a password reset before. Would you like me to guide you through the process again?"
));

// Second interaction - agent should remember
console.log('\nSecond interaction:');
const result2 = await agent.invoke(
    {
        messages: [new BaseMessage('user', "Actually, I prefer to be called Johnny")],
    },
    { customerId: 'customer-123' }
);

// Check stored memories
console.log('\nStored memories:');
const prefs = await memoryStore.mget(['customers:customer-123:preferences']);
console.log('Preferences:', prefs[0]);

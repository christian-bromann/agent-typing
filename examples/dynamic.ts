import { z } from 'zod';
import { createMiddleware, createAgent } from '../agent.js';

/**
 * Dynamic Model Middleware - Selects different models based on task complexity
 * 
 * This middleware analyzes the user's query and switches between:
 * - A fast model for simple queries
 * - A powerful model for complex reasoning
 */
export const dynamicModelMiddleware = createMiddleware({
    name: 'DynamicModel',
    stateSchema: z.object({
        taskComplexity: z.enum(['simple', 'complex']).default('simple'),
    }),
    contextSchema: z.object({
        models: z.object({
            fast: z.any(),
            powerful: z.any(),
        }),
    }),
    prepareCall: (options, state, runtime) => {
        // Analyze the last user message for complexity indicators
        const lastMessage = state.messages.at(-1);
        const complexIndicators = ['analyze', 'explain', 'complex', 'debug', 'architecture', 'design'];
        
        const isComplex = complexIndicators.some(indicator => 
            lastMessage?.content?.toLowerCase().includes(indicator)
        );
        
        // Select appropriate model
        const model = isComplex 
            ? runtime.context.models.powerful 
            : runtime.context.models.fast;
        
        console.log(`Using ${isComplex ? 'powerful' : 'fast'} model for this query`);
        
        return {
            ...options,
            model,
        };
    },
});

/**
 * Dynamic Tools Middleware - Adds/removes tools based on user intent
 * 
 * This middleware detects what the user wants to do and provides
 * only the relevant tools for that task.
 */
export const dynamicToolsMiddleware = createMiddleware({
    name: 'DynamicTools',
    stateSchema: z.object({
        detectedIntent: z.enum(['file_ops', 'search', 'calculation', 'general']).default('general'),
    }),
    contextSchema: z.object({}), // Empty schema to fix type inference
    prepareCall: (options, state, runtime) => {
        // Detect intent from the last user message
        const lastMessage = state.messages.at(-1);
        const messageContent = lastMessage?.content?.toLowerCase() || '';
        
        let intent: 'file_ops' | 'search' | 'calculation' | 'general' = 'general';
        
        if (messageContent.match(/\b(read|write|create|delete|file|save)\b/)) {
            intent = 'file_ops';
        } else if (messageContent.match(/\b(search|find|look|query)\b/)) {
            intent = 'search';
        } else if (messageContent.match(/\b(calculate|compute|math|sum|average)\b/)) {
            intent = 'calculation';
        }
        
        // Get tools for detected intent
        const tools = options.tools?.find(tool => tool.name === intent) || [];
        
        console.log(`Detected intent: ${intent}, providing ${tools.length} tools`);
        
        return {
            ...options,
            tools,
        };
    },
});

/**
 * Dynamic Prompts Middleware - Modifies system prompts based on context
 * 
 * This middleware adjusts the system prompt based on:
 * - User preferences (formal/casual)
 * - Task type (coding/writing/analysis)
 * - Conversation length (add summarization for long chats)
 */
export const dynamicPromptsMiddleware = createMiddleware({
    name: 'DynamicPrompts',
    stateSchema: z.object({
        conversationTone: z.enum(['formal', 'casual']).default('casual'),
        taskType: z.enum(['coding', 'writing', 'analysis']).default('coding'),
    }),
    contextSchema: z.object({
        userPreferences: z.object({
            tone: z.enum(['formal', 'casual']).optional(),
            expertise: z.enum(['beginner', 'intermediate', 'expert']).optional(),
        }).optional(),
    }),
    prepareCall: (options, state, runtime) => {
        const messageCount = state.messages.length;
        const tone = runtime.context.userPreferences?.tone || state.conversationTone;
        const expertise = runtime.context.userPreferences?.expertise || 'intermediate';
        
        // Build dynamic system prompt
        let systemMessage = '';
        
        // Add tone-specific instructions
        if (tone === 'formal') {
            systemMessage += 'Maintain a professional and formal tone. ';
        } else {
            systemMessage += 'Be friendly and conversational. ';
        }
        
        // Add expertise-level instructions
        switch (expertise) {
            case 'beginner':
                systemMessage += 'Explain concepts simply and avoid jargon. ';
                break;
            case 'expert':
                systemMessage += 'Use technical terms freely and be concise. ';
                break;
        }
        
        // Add task-specific instructions
        const lastMessage = state.messages.at(-1)?.content || '';
        if (lastMessage.includes('code') || lastMessage.includes('function')) {
            systemMessage += 'Focus on code quality and best practices. ';
        } else if (lastMessage.includes('explain') || lastMessage.includes('why')) {
            systemMessage += 'Provide detailed explanations with examples. ';
        }
        
        // Add summarization for long conversations
        if (messageCount > 10) {
            systemMessage += 'Be concise as this is a long conversation. ';
        }
        
        console.log(`Dynamic prompt: ${systemMessage}`);
        
        return {
            ...options,
            systemMessage,
        };
    },
});

/**
 * Example usage combining all three dynamic middlewares
 */
const agent = createAgent({
    model: "openai:gpt-4o", // Default model
    middlewares: [
        dynamicModelMiddleware,
        dynamicToolsMiddleware,
        dynamicPromptsMiddleware,
    ] as const,
    tools: [/** */], // Will be dynamically populated
});

// Mock models and tools for the example
const models = {
    fast: 'gpt-3.5-turbo',
    powerful: 'gpt-4',
};

// Invoke with dynamic context
const result = await agent.invoke('Analyze this complex architecture pattern', {
    models,
    userPreferences: {
        tone: 'formal',
        expertise: 'expert',
    },
} as any);

console.log(result);
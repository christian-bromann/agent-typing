import { z } from 'zod';
import { createMiddleware, createAgent, BaseMessage, AIMessage } from '../agent.js';

/**
 * Reflection Middleware - Implements Basic Reflection for improved response quality
 * 
 * This middleware implements a generator-reflector loop where:
 * 1. The generator creates an initial response
 * 2. The reflector critiques the response as a teacher
 * 3. The generator refines based on feedback
 * 4. Process repeats for a fixed number of iterations
 * 
 * Based on the "Basic Reflection" approach from the blog post, this is a simple
 * yet effective technique that trades extra compute time for improved output quality.
 * 
 * Key features:
 * - Configurable number of reflection iterations (default: 2)
 * - Custom reflection prompts for different use cases
 * - Can be enabled/disabled per request
 * - Maintains conversation context while internally managing reflection loop
 * 
 * The reflection process is transparent to the end user - they only see the final
 * refined response, not the intermediate drafts and critiques.
 */
export const reflectionMiddleware = createMiddleware({
    name: 'Reflection',
    stateSchema: z.object({
        // Track current iteration in the reflection loop
        reflectionIteration: z.number().default(0),
        // Store the current draft response
        currentDraft: z.string().default(''),
        // Store reflection feedback
        reflections: z.array(z.string()).default([]),
        // Track if we're in generator or reflector mode
        reflectionMode: z.enum(['generator', 'reflector', 'done']).default('generator'),
    }),
    contextSchema: z.object({
        // Configuration for reflection behavior
        reflection: z.object({
            enabled: z.boolean().default(true),
            maxIterations: z.number().default(2),
            // Optional custom reflection prompt
            reflectionPrompt: z.string().optional(),
        }).optional(),
    }),
    prepareCall: (options, state, runtime) => {
        if (!runtime.context.reflection?.enabled) {
            return undefined;
        }

        // Modify system prompt based on current mode
        let systemMessage = options.systemMessage || '';
        
        if (state.reflectionMode === 'generator') {
            if (state.reflectionIteration > 0) {
                // Add previous reflections to context for improvement
                systemMessage = `${systemMessage}\n\nPrevious feedback:\n${state.reflections.join('\n\n')}\n\nPlease improve your response based on this feedback.`;
            }
        } else if (state.reflectionMode === 'reflector') {
            // Use reflection prompt
            const reflectionPrompt = runtime.context.reflection.reflectionPrompt || 
                `You are a teacher reviewing a student's response. Provide constructive criticism focusing on:
                1. Accuracy and completeness
                2. Clarity and organization
                3. Missing important points
                4. Any errors or misconceptions
                
                Be specific and actionable in your feedback.`;
            
            systemMessage = reflectionPrompt;
            
            // Modify messages to include the draft for reflection
            const messages = [
                ...state.messages.slice(0, -1), // All messages except the last
                new BaseMessage('user', `Please review and critique this response:\n\n${state.currentDraft}`),
            ];
            
            return {
                ...options,
                systemMessage,
                messages,
            };
        }
        
        return {
            ...options,
            systemMessage,
        };
    },
    afterModel: async (state, runtime, controls) => {
        if (!runtime.context.reflection?.enabled || state.reflectionMode === 'done') {
            return;
        }

        // Get the last message (the model's response)
        const lastMessage = state.messages.at(-1);
        const response = lastMessage?.content || '';

        if (state.reflectionMode === 'generator') {
            // Store the generated draft
            const newState = {
                currentDraft: response,
                reflectionMode: 'reflector' as const,
            };
            
            // Jump back to model for reflection
            return controls.jumpTo('model', newState);
        } else if (state.reflectionMode === 'reflector') {
            // Store the reflection feedback
            const newReflections = [...state.reflections, response];
            const nextIteration = state.reflectionIteration + 1;
            
            // Check if we've reached max iterations
            if (nextIteration >= (runtime.context.reflection?.maxIterations ?? 0)) {
                // Final generation with all feedback
                return controls.jumpTo('model', {
                    reflections: newReflections,
                    reflectionIteration: nextIteration,
                    reflectionMode: 'done' as const,
                    messages: [
                        ...state.messages.slice(0, -2), // Remove reflection exchange
                        new AIMessage('assistant', state.currentDraft), // Keep final draft
                    ],
                });
            } else {
                // Continue to next iteration
                return controls.jumpTo('model', {
                    reflections: newReflections,
                    reflectionIteration: nextIteration,
                    reflectionMode: 'generator' as const,
                    messages: state.messages.slice(0, -2), // Remove reflection exchange
                });
            }
        }
    },
});

/**
 * Example usage of the Reflection middleware
 */
const agent = createAgent({
    model: "openai:gpt-4o-mini", // or any model
    middlewares: [reflectionMiddleware] as const,
});

// Example 1: Basic usage with default settings
const result1 = await agent.invoke({
    messages: [new BaseMessage('user', 'Explain how photosynthesis works')],
}, {
    reflection: {
        enabled: true,
        maxIterations: 2,
    },
});

console.log('Final response after reflection:');
console.log(result1.messages[result1.messages.length - 1]?.content || '');
console.log(`\nReflections generated: ${result1.reflections?.length || 0}`);

// Example 2: Custom reflection prompt and more iterations
const result2 = await agent.invoke(
    {
        messages: [new BaseMessage('user', 'Write a Python function to calculate fibonacci numbers')],
    },
    {
        reflection: {
            maxIterations: 3,
            reflectionPrompt: `You are a senior developer reviewing code. Focus on:
                1. Code efficiency and performance
                2. Edge cases and error handling
                3. Code readability and documentation
                4. Best practices and patterns`,
        },
    }
);

console.log('\nCode after reflection:');
console.log(result2.messages[result2.messages.length - 1]?.content || '');

// Example 3: Disabled reflection (normal response)
const result3 = await agent.invoke(
    {
        messages: [new BaseMessage('user', 'What is the capital of France?')],
    },
    {
        reflection: {
            enabled: false, // Simple query doesn't need reflection
        },
    }
);

console.log('\nDirect response (no reflection):');
console.log(result3.messages[result3.messages.length - 1]?.content || '');

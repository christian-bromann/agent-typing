import { z } from 'zod';
import { createMiddleware, createAgent, BaseMessage, AssistantMessage } from '../agent.js';

/**
 * Deep Agent Middleware - Implements the four core characteristics:
 * 1. Detailed system prompt
 * 2. Planning tool (todo list)
 * 3. Sub agents capability
 * 4. Virtual file system
 */
export const deepAgentMiddleware = createMiddleware({
    name: 'DeepAgent',
    stateSchema: z.object({
        // Planning tool - todo list stored in state
        todoList: z.array(z.object({
            id: z.string(),
            task: z.string(),
            status: z.enum(['pending', 'in-progress', 'completed']),
            notes: z.string().optional(),
        })).default([]),
        
        // Virtual file system - simple key-value store
        fileSystem: z.record(z.string(), z.string()).default({}),
        
        // Track sub-agent results
        subAgentResults: z.array(z.object({
            taskId: z.string(),
            result: z.string(),
        })).default([]),
        
        // Current phase of the agent
        phase: z.enum(['planning', 'executing', 'reviewing']).default('planning'),
    }),
    
    contextSchema: z.object({
        // Domain-specific instructions to add to system prompt
        customInstructions: z.string().optional(),
        // Enable/disable sub-agents
        enableSubAgents: z.boolean().default(true),
        // Maximum depth for sub-agent recursion
        maxDepth: z.number().default(3),
    }),
    
    prepareCall: (options, state, runtime) => {
        // 1. Detailed system prompt
        const systemPrompt = `You are a deep agent capable of complex, long-running tasks.

Core Capabilities:
- Break down complex tasks into manageable subtasks
- Maintain a todo list to track progress
- Store intermediate results and notes in your file system
- Spawn sub-agents for specialized subtasks when needed

Current Phase: ${state.phase}

Todo List:
${state.todoList.map(todo => 
    `- [${todo.status}] ${todo.task}${todo.notes ? ` (Notes: ${todo.notes})` : ''}`
).join('\n') || 'No tasks yet.'}

Virtual File System:
${Object.entries(state.fileSystem).map(([path, content]) => 
    `📄 ${path}: ${content.substring(0, 50)}...`
).join('\n') || 'No files stored.'}

${runtime.context.customInstructions ? `\nDomain-Specific Instructions:\n${runtime.context.customInstructions}` : ''}

Guidelines:
1. In planning phase: Break down the task into subtasks and update the todo list
2. In executing phase: Work through tasks systematically, update status as you go
3. In reviewing phase: Summarize what was accomplished and any remaining work
4. Use the file system to store important information between steps
5. Consider spawning sub-agents for specialized subtasks if enabled`;

        return {
            ...options,
            systemMessage: systemPrompt,
        };
    },
    
    afterModel: async (state, runtime, controls) => {
        // Simple state machine to demonstrate phase transitions
        let updatedState: any = {};
        
        // Parse assistant response to detect todo updates or file writes
        const lastMessage = state.messages.at(-1);
        if (lastMessage && lastMessage.role === 'assistant') {
            const content = lastMessage.content;
            
            // Detect todo list updates (simple pattern matching)
            if (content.includes('TODO:') || content.includes('Task:')) {
                const todoMatch = content.match(/TODO:\s*(.+)|Task:\s*(.+)/);
                if (todoMatch) {
                    const newTodo = {
                        id: `task-${Date.now()}`,
                        task: todoMatch[1] || todoMatch[2],
                        status: 'pending' as const,
                    };
                    updatedState.todoList = [...state.todoList, newTodo];
                }
            }
            
            // Detect file system writes (simple pattern matching)
            if (content.includes('SAVE:') || content.includes('FILE:')) {
                const fileMatch = content.match(/(SAVE|FILE):\s*(\S+)\s*=\s*(.+)/);
                if (fileMatch) {
                    const [_, __, filename, fileContent] = fileMatch;
                    updatedState.fileSystem = {
                        ...state.fileSystem,
                        [filename as string]: fileContent,
                    };
                }
            }
            
            // Simple phase transitions
            if (state.phase === 'planning' && state.todoList.length > 0) {
                updatedState.phase = 'executing';
            } else if (state.phase === 'executing' && 
                       state.todoList.every(todo => todo.status === 'completed')) {
                updatedState.phase = 'reviewing';
            }
        }
        
        // 3. Sub-agents capability (simplified)
        if (runtime.context.enableSubAgents && state.phase === 'executing') {
            const pendingTasks = state.todoList.filter(t => t.status === 'pending');
            
            if (pendingTasks.length > 0 && runtime.context.maxDepth > 0) {
                // Simulate spawning a sub-agent for the first pending task
                const task = pendingTasks[0];
                
                if (task) {
                    // Create a simple sub-agent
                    const subAgent = createAgent({
                        contextSchema: z.object({
                            parentTaskId: z.string(),
                        }),
                        middlewares: [] as const,
                    });
                    
                    // Simulate sub-agent execution
                    const subResult = await subAgent.invoke(
                        {
                            messages: [new BaseMessage('user', `Complete this subtask: ${task.task}`)],
                        },
                        { parentTaskId: task.id }
                    );
                    
                    // Store sub-agent result
                    updatedState.subAgentResults = [
                        ...state.subAgentResults,
                        {
                            taskId: task.id,
                            result: 'Subtask completed by sub-agent',
                        }
                    ];
                    
                    // Update task status
                    updatedState.todoList = state.todoList.map(t =>
                        t.id === task.id ? { ...t, status: 'completed' as const } : t
                    );
                }
            }
        }
        
        return Object.keys(updatedState).length > 0 ? updatedState : undefined;
    },
});

// Example usage
const deepAgent = createAgent({
    contextSchema: z.object({
        projectName: z.string(),
    }),
    middlewares: [deepAgentMiddleware] as const,
});

// Example invocation
const result = await deepAgent.invoke(
    {
        messages: [new BaseMessage('user', 'Research and implement a user authentication system with JWT tokens')],
    },
    {
        projectName: "MyApp",
        customInstructions: "Focus on security best practices and include rate limiting",
        enableSubAgents: true,
    }
);

console.log('Final state:', {
    todoList: result.todoList,
    fileSystem: Object.keys(result.fileSystem),
    phase: result.phase,
});

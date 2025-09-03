import { z } from "zod";

// Base message class for chat
export class BaseMessage {
    constructor(
        public role: 'user' | 'assistant' | 'system',
        public content: string
    ) {}
}

export class ToolMessage extends BaseMessage {
    type = 'tool';
    name = 'tool name';
    content = '';
}

export class AssistantMessage extends BaseMessage {
    type = 'assistant';
    content = '';
}

export class UserMessage extends BaseMessage {
    type = 'user';
    content = '';
}

export class AIMessage extends BaseMessage {
    type = 'ai';
    content = '';
}

// Tool-related types
export interface ToolCall {
    id: string;
    name: string;
    args: Record<string, any>;
}

export interface ToolResult {
    id: string;
    result: any;
    error?: string;
}

// Runtime information (readonly)
export interface Runtime<TContext = any> {
    readonly toolCalls: ToolCall[];
    readonly toolResults: ToolResult[];
    readonly tokenUsage: {
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly totalTokens: number;
    };
    readonly context: TContext;
    readonly currentIteration: number;
}

// Control flow interface
export interface Controls<TState = any> {
    jumpTo(target: 'model' | 'tools', stateUpdate?: Partial<TState>): ControlAction;
    terminate(result?: Partial<TState> | Error): ControlAction;
    retry(stateUpdate?: Partial<TState>, options?: RetryOptions): ControlAction;
}

// Control action type
export type ControlAction = {
    type: 'jump' | 'terminate' | 'retry';
    target?: string;
    stateUpdate?: any;
    result?: any;
    error?: Error;
};

// Middleware result type
export type MiddlewareResult<TState> = TState | ControlAction | void;

// Base middleware interface with unified state
export interface IMiddleware<
    TSchema extends z.ZodObject<z.ZodRawShape> = z.ZodObject<{}>,
    TContextSchema extends z.ZodObject<z.ZodRawShape> = z.ZodObject<{}>,
    TFullContext = any
> {
    stateSchema: TSchema;
    contextSchema?: TContextSchema;
    name: string;
    beforeModel?(
        state: z.infer<TSchema> & AgentBuiltInState,
        runtime: Runtime<TFullContext>, 
        controls: Controls<z.infer<TSchema> & AgentBuiltInState>
    ): Promise<MiddlewareResult<Partial<z.infer<TSchema>>>>;
    afterModel?(
        state: z.infer<TSchema> & AgentBuiltInState,
        runtime: Runtime<TFullContext>, 
        controls: Controls<z.infer<TSchema> & AgentBuiltInState>
    ): Promise<MiddlewareResult<Partial<z.infer<TSchema>>>>;
}



// defineMiddleware with automatic schema inference
export function defineMiddleware<
    TSchema extends z.ZodObject<any>,
    TContextSchema extends z.ZodObject<any> = z.ZodObject<{}>
>(
    config: {
        name: string;
        stateSchema: TSchema;
        contextSchema?: TContextSchema;
        beforeModel?: (
            state: z.infer<TSchema> & AgentBuiltInState,
            runtime: Runtime<z.infer<TContextSchema>>,
            controls: Controls<z.infer<TSchema> & AgentBuiltInState>
        ) => Promise<MiddlewareResult<Partial<z.infer<TSchema>>>> | MiddlewareResult<Partial<z.infer<TSchema>>>;
        afterModel?: (
            state: z.infer<TSchema> & AgentBuiltInState,
            runtime: Runtime<z.infer<TContextSchema>>,
            controls: Controls<z.infer<TSchema> & AgentBuiltInState>
        ) => Promise<MiddlewareResult<Partial<z.infer<TSchema>>>> | MiddlewareResult<Partial<z.infer<TSchema>>>;
    }
): IMiddleware<TSchema, TContextSchema, any>;

// Implementation
export function defineMiddleware(config: any): any {
    const middleware: IMiddleware<any, any, any> = {
        name: config.name,
        stateSchema: config.stateSchema,
        contextSchema: config.contextSchema,
    };
    
    if (config.beforeModel) {
        middleware.beforeModel = async (state, runtime, controls) => 
            Promise.resolve(config.beforeModel!(state, runtime, controls));
    }
    
    if (config.afterModel) {
        middleware.afterModel = async (state, runtime, controls) => 
            Promise.resolve(config.afterModel!(state, runtime, controls));
    }
    
    return middleware;
}

// Type for the agent's built-in state properties
export type AgentBuiltInState = {
    messages: BaseMessage[];
};

// Type for the final merged state
type InferMergedState<TMiddlewares extends readonly any[]> = 
    InferMiddlewareStates<TMiddlewares> & AgentBuiltInState;

// Helper type to extract state type from agent configuration
export type InferAgentState<
    TMiddlewares extends readonly any[]
> = InferMergedState<TMiddlewares>;

// Helper to infer all middleware states
type InferMiddlewareStates<T extends readonly any[]> = T extends readonly [
    infer First,
    ...infer Rest
]
    ? First extends IMiddleware<infer Schema, any, any>
        ? Rest extends readonly any[]
            ? z.infer<Schema> & InferMiddlewareStates<Rest>
            : z.infer<Schema>
        : Rest extends readonly any[]
            ? InferMiddlewareStates<Rest>
            : {}
    : {};

// Helper to infer all middleware contexts
type InferMiddlewareContexts<T extends readonly any[]> = T extends readonly [
    infer First,
    ...infer Rest
]
    ? First extends IMiddleware<any, infer ContextSchema, any>
        ? ContextSchema extends z.ZodObject<any>
            ? Rest extends readonly any[]
                ? z.infer<ContextSchema> & InferMiddlewareContexts<Rest>
                : z.infer<ContextSchema>
            : Rest extends readonly any[]
                ? InferMiddlewareContexts<Rest>
                : {}
        : Rest extends readonly any[]
            ? InferMiddlewareContexts<Rest>
            : {}
    : {};

/**
 * Configurations for retry call (see below for details)
 */
interface RetryOptions {
    /** Reason for retry (for logging) */
    reason?: string;
    /** Maximum retry attempts (default: 3) */
    maxAttempts?: number;
    /** Which node to retry from (default: current node) */
    retryFrom?: "before_model" | "tools" | "after_model";
}

// Helper to merge all context schemas into one
function mergeContextSchemas<
    TContextSchema extends z.ZodObject<z.ZodRawShape>,
    TMiddlewares extends readonly IMiddleware<any, any, any>[]
>(
    contextSchema?: TContextSchema,
    middlewares?: TMiddlewares
): z.ZodObject<any> {
    let mergedSchema = contextSchema || z.object({});
    
    if (middlewares) {
        for (const middleware of middlewares) {
            if (middleware.contextSchema) {
                mergedSchema = mergedSchema.merge(middleware.contextSchema as z.ZodObject<any>);
            }
        }
    }
    
    return mergedSchema;
}

export function createAgent<
    TContextSchema extends z.ZodObject<z.ZodRawShape> = z.ZodObject<{}>,
    TMiddlewares extends readonly IMiddleware<any, any, any>[] = []
>({
    contextSchema,
    middlewares,
}: {
    contextSchema?: TContextSchema;
    middlewares: TMiddlewares;
}) {
    // Create properly typed middleware array with full state type
    type FullState = InferMergedState<TMiddlewares>;
    type FullContext = (TContextSchema extends z.ZodObject<any> ? z.infer<TContextSchema> : {}) & InferMiddlewareContexts<TMiddlewares>;
    
    // Create merged context schema for validation
    const mergedContextSchema = mergeContextSchemas(contextSchema, middlewares);
    
    return {
        invoke: async (
            message: string,
            context: FullContext
        ): Promise<FullState> => {
            // Create initial runtime
            const runtime: Runtime<FullContext> = {
                toolCalls: [],
                toolResults: [],
                tokenUsage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    totalTokens: 0
                },
                context: context,
                currentIteration: 0
            };

            // Initialize middleware states by parsing their schemas
            const middlewareStates: Record<string, any> = {};
            for (const middleware of middlewares) {
                // Parse the schema to get default values
                const defaultState = middleware.stateSchema.parse({});
                // Spread the default state properties directly into middlewareStates
                Object.assign(middlewareStates, defaultState);
            }

            // Create initial merged state
            const initialState = {
                ...middlewareStates,
                messages: [new BaseMessage('user', message)]
            } as FullState;

            // Process middlewares
            let currentState = initialState;
            
            for (const middleware of middlewares) {
                const controls = {} as Controls<FullState>;
                
                if (middleware.beforeModel) {
                    const result = await middleware.beforeModel(
                        currentState,
                        runtime,
                        controls
                    );
                    
                    // Handle control actions or state updates
                    if (result && typeof result === 'object' && 'type' in result) {
                        // Handle control action (terminate, jump, retry)
                        // Implementation would handle these control flows
                    } else if (result) {
                        // Merge partial state update
                        currentState = { ...currentState, ...result };
                    }
                }
            }

            return currentState;
        },
    };
}
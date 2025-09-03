import { z } from "zod";

// Base message class for chat
export class BaseMessage {
    constructor(
        public role: 'user' | 'assistant' | 'system',
        public content: string
    ) {}
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
export interface Runtime {
    readonly toolCalls: ToolCall[];
    readonly toolResults: ToolResult[];
    readonly tokenUsage: {
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly totalTokens: number;
    };
    readonly context: Record<string, any>; // User-provided context from invoke
    readonly currentIteration: number;
}

// Control flow interface
export interface Controls<TState = any> {
    jumpTo(target: 'model' | 'tools' | string, stateUpdate?: Partial<TState>): ControlAction;
    terminate(result?: any, error?: Error): ControlAction;
    retry(stateUpdate?: Partial<TState>): ControlAction;
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

// Base middleware interface
export interface IMiddleware<TSchema extends z.ZodObject<any> = z.ZodObject<any>> {
    stateSchema: TSchema;
    name: string;
    beforeModel?(
        state: z.infer<TSchema>, 
        runtime: Runtime, 
        controls: Controls<z.infer<TSchema>>
    ): Promise<MiddlewareResult<z.infer<TSchema>>>;
    afterModel?(
        state: z.infer<TSchema>, 
        runtime: Runtime, 
        controls: Controls<z.infer<TSchema>>
    ): Promise<MiddlewareResult<z.infer<TSchema>>>;
}

// Abstract base class for middlewares (kept for backwards compatibility)
export abstract class Middleware<TSchema extends z.ZodObject<any> = z.ZodObject<any>> implements IMiddleware<TSchema> {
    abstract stateSchema: TSchema;
    abstract name: string;
    abstract beforeModel(
        state: z.infer<TSchema>, 
        runtime: Runtime, 
        controls: Controls<z.infer<TSchema>>
    ): Promise<MiddlewareResult<z.infer<TSchema>>>;
    abstract afterModel(
        state: z.infer<TSchema>, 
        runtime: Runtime, 
        controls: Controls<z.infer<TSchema>>
    ): Promise<MiddlewareResult<z.infer<TSchema>>>;
}

// Factory function for creating middlewares with better DX
export function defineMiddleware<TSchema extends z.ZodObject<any>>(
    config: {
        name: string;
        stateSchema: TSchema;
        beforeModel?: (
            state: z.infer<TSchema>, 
            runtime: Runtime, 
            controls: Controls<z.infer<TSchema>>
        ) => Promise<MiddlewareResult<z.infer<TSchema>>> | MiddlewareResult<z.infer<TSchema>>;
        afterModel?: (
            state: z.infer<TSchema>, 
            runtime: Runtime, 
            controls: Controls<z.infer<TSchema>>
        ) => Promise<MiddlewareResult<z.infer<TSchema>>> | MiddlewareResult<z.infer<TSchema>>;
    }
): IMiddleware<TSchema> {
    const middleware: IMiddleware<TSchema> = {
        name: config.name,
        stateSchema: config.stateSchema,
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
type AgentBuiltInState = {
    messages: BaseMessage[];
};

// Type for the final merged state
type InferMergedState<
    TBase extends z.ZodObject<any>,
    TMiddlewares extends readonly (Middleware | IMiddleware)[]
> = z.infer<TBase> & InferMiddlewareStates<TMiddlewares> & AgentBuiltInState;

// Helper to infer all middleware states (updated to work with both Middleware class and IMiddleware interface)
type InferMiddlewareStates<T extends readonly (Middleware | IMiddleware)[]> = T extends readonly [
    infer First,
    ...infer Rest
]
    ? First extends IMiddleware<infer Schema>
        ? Rest extends readonly (Middleware | IMiddleware)[]
            ? z.infer<Schema> & InferMiddlewareStates<Rest>
            : z.infer<Schema>
        : First extends Middleware<infer Schema>
            ? Rest extends readonly (Middleware | IMiddleware)[]
                ? z.infer<Schema> & InferMiddlewareStates<Rest>
                : z.infer<Schema>
            : {}
    : {};

// Implementation of Controls
function createControls<TState>(): Controls<TState> {
    return {
        jumpTo(target: 'model' | 'tools' | string, stateUpdate?: Partial<TState>): ControlAction {
            return {
                type: 'jump',
                target,
                stateUpdate
            };
        },
        terminate(result?: any, error?: Error): ControlAction {
            const action: ControlAction = {
                type: 'terminate',
                result
            };
            if (error !== undefined) {
                action.error = error;
            }
            return action;
        },
        retry(stateUpdate?: Partial<TState>): ControlAction {
            return {
                type: 'retry',
                stateUpdate
            };
        }
    };
}

export function createAgent<
    TStateSchema extends z.ZodObject<any>,
    TMiddlewares extends readonly (Middleware | IMiddleware)[]
>({
    stateSchema,
    middlewares,
}: {
    stateSchema: TStateSchema;
    middlewares: TMiddlewares;
}) {
    return {
        invoke: async (input: { 
            message: string;
            context?: Record<string, any>;
        }): Promise<InferMergedState<TStateSchema, TMiddlewares>> => {
            // Create initial runtime
            const runtime: Runtime = {
                toolCalls: [],
                toolResults: [],
                tokenUsage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    totalTokens: 0
                },
                context: input.context || {},
                currentIteration: 0
            };

            // Create initial state with built-in properties
            const initialState = {
                messages: [new BaseMessage('user', input.message)]
            } as InferMergedState<TStateSchema, TMiddlewares>;

            // Implementation would process middlewares here
            // For now, just return the properly typed state
            return initialState;
        },
    };
}
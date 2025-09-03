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

// Language model and tool types
export type LanguageModelLike = any; // Placeholder for actual language model type
export type ClientTool = any; // Placeholder for client tool type
export type ServerTool = any; // Placeholder for server tool type

/**
 * Configuration for modifying a model call at runtime.
 * All fields are optional and only provided fields will override defaults.
 */
export interface PreparedCall {
    /**
     * The model to use for this step.
     */
    model?: LanguageModelLike;
    /**
     * The messages to send to the model.
     */
    messages?: BaseMessage[];
    /**
     * The system message for this step.
     */
    systemMessage?: string;
    /**
     * Tool choice configuration (model-specific format).
     * Can be one of:
     * - `"auto"`: means the model can pick between generating a message or calling one or more tools.
     * - `"none"`: means the model will not call any tool and instead generates a message.
     * - `"required"`: means the model must call one or more tools.
     * - `{ type: "function", function: { name: string } }`: The model will use the specified function.
     */
    toolChoice?:
        | "auto"
        | "none"
        | "required"
        | { type: "function"; function: { name: string } };

    /**
     * The tools to make available for this step.
     * Can be tool names (strings) or tool instances.
     */
    tools?: (string | ClientTool | ServerTool)[];
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
    TSchema extends z.ZodObject<z.ZodRawShape> | undefined = undefined,
    TContextSchema extends z.ZodObject<z.ZodRawShape> | undefined = undefined,
    TFullContext = any
> {
    stateSchema?: TSchema;
    contextSchema?: TContextSchema;
    name: string;
    /**
     * Runs before each LLM call, can modify call parameters, changes are not persistent
     * e.g. if you change `model`, it will only be changed for the next model call
     * 
     * @param options - Current call options (can be modified by previous middleware)
     * @param state - Current state (read-only in this phase)
     * @param runtime - Runtime context and metadata
     * @returns Modified options or undefined to pass through
     */
    prepareCall?(
        options: PreparedCall,
        state: (TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}) & AgentBuiltInState,
        runtime: Runtime<TFullContext>
    ): Promise<PreparedCall | undefined> | PreparedCall | undefined;
    beforeModel?(
        state: (TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}) & AgentBuiltInState,
        runtime: Runtime<TFullContext>, 
        controls: Controls<(TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}) & AgentBuiltInState>
    ): Promise<MiddlewareResult<Partial<TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}>>>;
    afterModel?(
        state: (TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}) & AgentBuiltInState,
        runtime: Runtime<TFullContext>, 
        controls: Controls<(TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}) & AgentBuiltInState>
    ): Promise<MiddlewareResult<Partial<TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}>>>;
}

// createMiddleware with automatic schema inference
export function createMiddleware<
    TSchema extends z.ZodObject<any> | undefined = undefined,
    TContextSchema extends z.ZodObject<any> | undefined = undefined
>(
    config: {
        name: string;
        stateSchema?: TSchema;
        contextSchema?: TContextSchema;
        prepareCall?: (
            options: PreparedCall,
            state: (TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}) & AgentBuiltInState,
            runtime: Runtime<TContextSchema extends z.ZodObject<any> ? z.infer<TContextSchema> : {}>
        ) => Promise<PreparedCall | undefined> | PreparedCall | undefined;
        beforeModel?: (
            state: (TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}) & AgentBuiltInState,
            runtime: Runtime<TContextSchema extends z.ZodObject<any> ? z.infer<TContextSchema> : {}>,
            controls: Controls<(TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}) & AgentBuiltInState>
        ) => Promise<MiddlewareResult<Partial<TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}>>> | MiddlewareResult<Partial<TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}>>;
        afterModel?: (
            state: (TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}) & AgentBuiltInState,
            runtime: Runtime<TContextSchema extends z.ZodObject<any> ? z.infer<TContextSchema> : {}>,
            controls: Controls<(TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}) & AgentBuiltInState>
        ) => Promise<MiddlewareResult<Partial<TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}>>> | MiddlewareResult<Partial<TSchema extends z.ZodObject<any> ? z.infer<TSchema> : {}>>;
    }
): IMiddleware<TSchema, TContextSchema, any>;

// Implementation
export function createMiddleware(config: any): any {
    const middleware: IMiddleware<any, any, any> = {
        name: config.name,
        stateSchema: config.stateSchema,
        contextSchema: config.contextSchema,
    };
    
    if (config.prepareCall) {
        middleware.prepareCall = async (options, state, runtime) => 
            Promise.resolve(config.prepareCall!(options, state, runtime));
    }
    
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
        ? Schema extends z.ZodObject<any>
            ? Rest extends readonly any[]
                ? z.infer<Schema> & InferMiddlewareStates<Rest>
                : z.infer<Schema>
            : Rest extends readonly any[]
                ? InferMiddlewareStates<Rest>
                : {}
        : Rest extends readonly any[]
            ? InferMiddlewareStates<Rest>
            : {}
    : {};

// Helper type to extract keys from a Zod schema
type ExtractZodKeys<T> = T extends z.ZodObject<infer Shape> ? keyof Shape : T extends undefined ? never : never;

// Helper type to collect all context keys from middlewares
type CollectContextKeys<T extends readonly any[], Acc = never> = T extends readonly [
    infer First,
    ...infer Rest
]
    ? First extends IMiddleware<any, infer ContextSchema, any>
        ? ContextSchema extends z.ZodObject<any>
            ? Rest extends readonly any[]
                ? CollectContextKeys<Rest, Acc | ExtractZodKeys<ContextSchema>>
                : Acc | ExtractZodKeys<ContextSchema>
            : Rest extends readonly any[]
                ? CollectContextKeys<Rest, Acc>
                : Acc
        : Rest extends readonly any[]
            ? CollectContextKeys<Rest, Acc>
            : Acc
    : Acc;

// Helper type to find duplicate keys
type FindDuplicateKeys<T extends readonly any[], SeenKeys = never> = T extends readonly [
    infer First,
    ...infer Rest
]
    ? First extends IMiddleware<any, infer ContextSchema, any>
        ? ContextSchema extends z.ZodObject<any>
            ? ExtractZodKeys<ContextSchema> extends infer CurrentKeys
                ? CurrentKeys extends keyof any
                    ? CurrentKeys & SeenKeys extends never
                        ? Rest extends readonly any[]
                            ? FindDuplicateKeys<Rest, SeenKeys | CurrentKeys>
                            : never
                        : CurrentKeys & SeenKeys // Return the duplicate keys
                    : Rest extends readonly any[]
                        ? FindDuplicateKeys<Rest, SeenKeys>
                        : never
                : never
            : Rest extends readonly any[]
                ? FindDuplicateKeys<Rest, SeenKeys>
                : never
        : Rest extends readonly any[]
            ? FindDuplicateKeys<Rest, SeenKeys>
            : never
    : never;

// Error message type for duplicate context properties
type DuplicateContextError<Keys extends string> = {
    error: `Duplicate context properties detected: ${Keys}. Each context property name must be unique across all middlewares and the agent's context schema.`;
};

// Helper to check for duplicates between agent context and middleware contexts
type CheckForDuplicateContexts<
    TContextSchema extends z.ZodObject<any> | undefined,
    TMiddlewares extends readonly any[]
> = TContextSchema extends z.ZodObject<any>
    ? ExtractZodKeys<TContextSchema> & CollectContextKeys<TMiddlewares> extends never
        ? FindDuplicateKeys<TMiddlewares> extends never
            ? true // No duplicates
            : DuplicateContextError<Extract<FindDuplicateKeys<TMiddlewares>, string>>
        : DuplicateContextError<Extract<ExtractZodKeys<TContextSchema> & CollectContextKeys<TMiddlewares>, string>>
    : FindDuplicateKeys<TMiddlewares> extends never
        ? true // No duplicates
        : DuplicateContextError<Extract<FindDuplicateKeys<TMiddlewares>, string>>;

// Helper to infer all middleware contexts (with duplicate check)
type InferMiddlewareContexts<T extends readonly any[]> = 
    FindDuplicateKeys<T> extends never
        ? T extends readonly [
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
            : {}
        : DuplicateContextError<Extract<FindDuplicateKeys<T>, string>>;

// Helper to infer all middleware contexts (input types with optional defaults)
type InferMiddlewareContextsInput<T extends readonly any[]> = 
    FindDuplicateKeys<T> extends never
        ? T extends readonly [
            infer First,
            ...infer Rest
        ]
            ? First extends IMiddleware<any, infer ContextSchema, any>
                ? ContextSchema extends z.ZodObject<any>
                    ? Rest extends readonly any[]
                        ? z.input<ContextSchema> & InferMiddlewareContextsInput<Rest>
                        : z.input<ContextSchema>
                    : Rest extends readonly any[]
                        ? InferMiddlewareContextsInput<Rest>
                        : {}
                : Rest extends readonly any[]
                    ? InferMiddlewareContextsInput<Rest>
                    : {}
            : {}
        : DuplicateContextError<Extract<FindDuplicateKeys<T>, string>>;

// Helper to check if all properties of a type are optional
type IsAllOptional<T> = T extends Record<string, any> 
    ? {} extends T 
        ? true 
        : false
    : true;

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

// Create a branded error type that TypeScript will display nicely
type ContextPropertyConflictError<TKey extends string> = 
    `Error: Context property '${TKey}' is defined in multiple places. Each context property must have a unique name across the agent's contextSchema and all middleware contextSchemas.`;

// Updated createAgent with clearer error reporting
export function createAgent<
    TContextSchema extends z.ZodObject<z.ZodRawShape> | undefined = undefined,
    TMiddlewares extends readonly IMiddleware<any, any, any>[] = []
>(config: CheckForDuplicateContexts<TContextSchema, TMiddlewares> extends DuplicateContextError<infer Keys>
    ? Keys extends string
        ? ContextPropertyConflictError<Keys>
        : {
            contextSchema?: TContextSchema;
            middlewares?: TMiddlewares;
        }
    : {
        model?: string;
        tools?: (string | ClientTool | ServerTool)[];
        contextSchema?: TContextSchema;
        middlewares?: TMiddlewares;
    }
) {
    // Create properly typed middleware array with full state type
    type FullState = InferMergedState<TMiddlewares>;
    // Use z.input to make fields with defaults optional
    type FullContext = TContextSchema extends z.ZodObject<any> 
        ? CheckForDuplicateContexts<TContextSchema, TMiddlewares> extends true
            ? z.input<TContextSchema> & InferMiddlewareContextsInput<TMiddlewares>
            : never
        : InferMiddlewareContextsInput<TMiddlewares>;
    
    // Type assertion needed because TypeScript can't narrow the conditional type
    const { contextSchema: cs, middlewares: mw } = config as {
        contextSchema?: TContextSchema;
        middlewares?: TMiddlewares;
    };
    
    // Create merged context schema for validation
    const mergedContextSchema = mergeContextSchemas(cs, mw);
    
    return {
        invoke: async (
            message: string,
            ...args: IsAllOptional<FullContext> extends true 
                ? [context?: FullContext] 
                : [context: FullContext]
        ): Promise<FullState> => {
            // Parse and validate context with defaults
            const context = mergedContextSchema.parse(args[0] ?? {}) as FullContext;
            
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
            for (const middleware of mw || []) {
                if (middleware.stateSchema) {
                    // Parse the schema to get default values
                    const defaultState = middleware.stateSchema.parse({});
                    // Spread the default state properties directly into middlewareStates
                    Object.assign(middlewareStates, defaultState);
                }
            }

            // Create initial merged state
            const initialState = {
                ...middlewareStates,
                messages: [new BaseMessage('user', message)]
            } as FullState;

            // Process middlewares
            let currentState = initialState;
            
            for (const middleware of mw || []) {
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
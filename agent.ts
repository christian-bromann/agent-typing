import { z } from "zod";

// Base middleware interface
export interface IMiddleware<TSchema extends z.ZodObject<any> = z.ZodObject<any>> {
    stateSchema: TSchema;
    name: string;
    beforeModel?(state: z.infer<TSchema>): Promise<z.infer<TSchema>>;
    afterModel?(state: z.infer<TSchema>): Promise<z.infer<TSchema>>;
}

// Abstract base class for middlewares (kept for backwards compatibility)
export abstract class Middleware<TSchema extends z.ZodObject<any> = z.ZodObject<any>> implements IMiddleware<TSchema> {
    abstract stateSchema: TSchema;
    abstract name: string;
    abstract beforeModel(state: z.infer<TSchema>): Promise<z.infer<TSchema>>;
    abstract afterModel(state: z.infer<TSchema>): Promise<z.infer<TSchema>>;
}

// Factory function for creating middlewares with better DX
export function defineMiddleware<TSchema extends z.ZodObject<any>>(
    config: {
        name: string;
        stateSchema: TSchema;
        beforeModel?: (state: z.infer<TSchema>) => Promise<z.infer<TSchema>> | z.infer<TSchema>;
        afterModel?: (state: z.infer<TSchema>) => Promise<z.infer<TSchema>> | z.infer<TSchema>;
    }
): IMiddleware<TSchema> {
    return {
        name: config.name,
        stateSchema: config.stateSchema,
        beforeModel: config.beforeModel 
            ? async (state) => Promise.resolve(config.beforeModel!(state))
            : async (state) => state,
        afterModel: config.afterModel
            ? async (state) => Promise.resolve(config.afterModel!(state))
            : async (state) => state,
    };
}

export class BaseMessage {}

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
        invoke: async (input: { message: string }): Promise<InferMergedState<TStateSchema, TMiddlewares>> => {
            // Implementation details would go here
            // For now, just return a properly typed empty object
            return {} as InferMergedState<TStateSchema, TMiddlewares>;
        },
    };
}
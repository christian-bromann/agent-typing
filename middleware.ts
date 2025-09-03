import { z } from "zod";
import { Middleware, defineMiddleware } from "./agent.js";

// Example 1: Using the new defineMiddleware function (recommended approach)
// Developers only need to define the schema once, and all types are inferred automatically
export const middlewareA = defineMiddleware({
    name: "MiddlewareA",
    stateSchema: z.object({
        customPropertyA: z.boolean(),
    }),
    beforeModel: (state) => {
        console.log("MiddlewareA beforeModel");
        // state is automatically typed as { customPropertyA: boolean }
        return state;
    },
    afterModel: (state) => {
        console.log("MiddlewareA afterModel");
        // state is automatically typed as { customPropertyA: boolean }
        return state;
    },
});

// Example 2: Using defineMiddleware with async functions
export const middlewareB = defineMiddleware({
    name: "MiddlewareB",
    stateSchema: z.object({
        customPropertyB: z.enum(["a", "b", "c"]),
    }),
    beforeModel: async (state) => {
        console.log("MiddlewareB beforeModel");
        // Can be async or sync - the factory handles both
        return state;
    },
    afterModel: async (state) => {
        console.log("MiddlewareB afterModel");
        return state;
    },
});

// Example 3: Traditional approach using class inheritance (still supported)
// This requires more boilerplate but gives full control
const middlewareCSchema = z.object({
    customPropertyC: z.number(),
});

export class MiddlewareC extends Middleware<typeof middlewareCSchema> {
    stateSchema = middlewareCSchema;
    name = "MiddlewareC" as const;

    async beforeModel(state: z.infer<typeof middlewareCSchema>): Promise<z.infer<typeof middlewareCSchema>> {
        console.log("MiddlewareC beforeModel");
        return state;
    }

    async afterModel(state: z.infer<typeof middlewareCSchema>): Promise<z.infer<typeof middlewareCSchema>> {
        console.log("MiddlewareC afterModel");
        return state;
    }
}
import { z } from "zod";
import { createAgent } from "./agent.js";
import { middlewareA, middlewareB, MiddlewareC } from "./middleware.js";

const stateSchema = z.object({
    name: z.string(),
    age: z.number(),
});

const agent = createAgent({
    stateSchema,
    middlewares: [
        /**
         * No need to instantiate - just pass the middleware directly
         * Adds `customPropertyA` to the state
         */
        middlewareA,
        /**
         * Adds `customPropertyB` to the state
         */
        middlewareB,
        /**
         * Adds `customPropertyC` to the state
         */
        new MiddlewareC(),
    ] as const,
});

const result = await agent.invoke({
    message: "Hello, world!",
});

console.log(result.name); // should be typed as string from `stateSchema`
console.log(result.age); // should be typed as number from `stateSchema`
console.log(result.customPropertyA); // should be typed as boolean from `MiddlewareA`
console.log(result.customPropertyB); // should be typed as enum from `MiddlewareB`
console.log(result.customPropertyC); // should be typed as number from `MiddlewareC`
console.log(result.messages); // should be typed as BaseMessage[] from agent's built-in state
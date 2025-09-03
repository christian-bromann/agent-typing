import { z } from "zod";
import { createAgent } from "./agent.js";
import { middlewareA, middlewareB, middlewareC, middlewareD } from "./middleware.js";

// Example 1: Using pre-defined middlewares
const agent = createAgent({
    contextSchema: z.object({
        name: z.string(),
        age: z.number(),
        country: z.string().default("USA"),

        /**
         * Comment this out to trigger a conflict with middlewareC.
         * Observer the type error message.
         */
        // customContextC: z.number(),
    }),
    middlewares: [
        /**
         * No need to instantiate - just pass the middleware directly
         * Adds `customStateA` to the state
         */
        middlewareA,
        /**
         * Adds `customStateB` to the state
         */
        middlewareB,
        /**
         * Adds `customStateC` to the state
         */
        middlewareC,
        /**
         * Adds nothing to the state
         */
        middlewareD,
    ] as const,
});

const result = await agent.invoke("Hello, world!", {
    name: "John",
    age: 30,

    // optional types are not required to be provided
    // country: "USA",
    
    // Context from middlewares:
    customContextA: true,    // required by middlewareA
    customContextB: 42,      // required by middlewareB
    customContextC: "a",     // required by middlewareC
});

// Result contains merged state from all middlewares
console.log(result.customStateA); // boolean from MiddlewareA
console.log(result.customStateB); // enum from MiddlewareB
console.log(result.customStateC); // number from middlewareC
console.log(result.messages); // BaseMessage[] from agent's built-in state

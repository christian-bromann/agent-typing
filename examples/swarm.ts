import { z } from 'zod';
import { defineMiddleware, createAgent, BaseMessage, AIMessage } from '../agent.js';

/**
 * Swarm Agent Middleware
 * 
 * This middleware implements a multi-agent swarm system where specialized agents
 * can collaborate and hand off tasks to each other. Inspired by the emergency
 * response system, but simplified for demonstration.
 */

// Define agent types
type AgentType = 'coordinator' | 'researcher' | 'coder' | 'reviewer';

// Define a handoff message type
interface HandoffMessage {
  from: AgentType;
  to: AgentType;
  reason: string;
  context: Record<string, any>;
}

// Agent definitions with their specialized prompts and capabilities
const AGENT_DEFINITIONS: Record<AgentType, {
  name: string;
  systemPrompt: string;
  canHandoffTo: AgentType[];
}> = {
  coordinator: {
    name: 'Task Coordinator',
    systemPrompt: `You are the Task Coordinator. Your role is to:
- Analyze incoming requests and determine which specialist agent should handle them
- Break down complex tasks into subtasks
- Delegate to appropriate specialists: researcher (for information gathering), coder (for implementation), reviewer (for code review)
- Summarize results from specialists`,
    canHandoffTo: ['researcher', 'coder', 'reviewer']
  },
  researcher: {
    name: 'Research Specialist',
    systemPrompt: `You are the Research Specialist. Your role is to:
- Gather information and context about technical topics
- Research best practices and patterns
- Provide detailed analysis and recommendations
- Hand back to coordinator with findings or hand off to coder if implementation is needed`,
    canHandoffTo: ['coordinator', 'coder']
  },
  coder: {
    name: 'Implementation Specialist',
    systemPrompt: `You are the Implementation Specialist. Your role is to:
- Write clean, efficient code based on requirements
- Implement features and fixes
- Follow best practices and patterns
- Hand off to reviewer for code review or back to coordinator when complete`,
    canHandoffTo: ['coordinator', 'reviewer']
  },
  reviewer: {
    name: 'Code Review Specialist',
    systemPrompt: `You are the Code Review Specialist. Your role is to:
- Review code for quality, security, and best practices
- Suggest improvements and optimizations
- Ensure code meets requirements
- Hand back to coder for fixes or coordinator when approved`,
    canHandoffTo: ['coordinator', 'coder']
  }
};

// Create the swarm middleware
export const swarmMiddleware = defineMiddleware({
  name: 'SwarmAgentMiddleware',
  
  // State schema tracks current agent and handoff history
  stateSchema: z.object({
    currentAgent: z.enum(['coordinator', 'researcher', 'coder', 'reviewer']).default('coordinator'),
    handoffHistory: z.array(z.object({
      from: z.enum(['coordinator', 'researcher', 'coder', 'reviewer']),
      to: z.enum(['coordinator', 'researcher', 'coder', 'reviewer']),
      reason: z.string(),
      timestamp: z.string()
    })).default([]),
    agentOutputs: z.record(z.string(), z.array(z.string())).default({})
  }),
  
  // Context schema for configuration
  contextSchema: z.object({
    maxHandoffs: z.number().default(5),
    verbose: z.boolean().default(true)
  }),
  
  // Prepare the model call based on current agent
  prepareCall: (options, state, runtime) => {
    const agent = AGENT_DEFINITIONS[state.currentAgent];
    
    // Add agent-specific system message
    const systemMessage = `${agent.systemPrompt}

Current task context:
- You are agent: ${agent.name}
- Handoff history: ${state.handoffHistory.length} handoffs so far
- You can hand off to: ${agent.canHandoffTo.join(', ')}

To hand off to another agent, end your response with:
HANDOFF_TO: <agent_name>
REASON: <reason for handoff>`;

    return {
      ...options,
      systemMessage
    };
  },
  
  // Process response after model call
  afterModel: async (state, runtime, controls) => {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];
    
    if (!lastMessage || !(lastMessage instanceof AIMessage)) {
      return;
    }
    
    const content = lastMessage.content;
    const currentAgent = state.currentAgent;
    
    // Store agent output
    const agentOutputs = { ...state.agentOutputs };
    if (!agentOutputs[currentAgent]) {
      agentOutputs[currentAgent] = [];
    }
    agentOutputs[currentAgent]!.push(content);
    
    // Check for handoff directive
    const handoffMatch = content.match(/HANDOFF_TO:\s*(\w+)\s*\nREASON:\s*(.+)/);
    
    if (handoffMatch && handoffMatch[1] && handoffMatch[2]) {
      const targetAgent = handoffMatch[1].toLowerCase() as AgentType;
      const reason = handoffMatch[2];
      
      // Validate handoff
      const agent = AGENT_DEFINITIONS[currentAgent];
      if (!agent.canHandoffTo.includes(targetAgent)) {
        if (runtime.context.verbose) {
          console.log(`❌ Invalid handoff: ${currentAgent} cannot hand off to ${targetAgent}`);
        }
        return { agentOutputs };
      }
      
      // Check handoff limit
      if (state.handoffHistory.length >= runtime.context.maxHandoffs) {
        if (runtime.context.verbose) {
          console.log(`⚠️  Handoff limit reached (${runtime.context.maxHandoffs}), terminating`);
        }
        return controls.terminate({
          ...state,
          agentOutputs,
          messages: [
            ...messages,
            new AIMessage('assistant', `[System] Handoff limit reached. Task completed by ${currentAgent}.`)
          ]
        });
      }
      
      // Perform handoff
      const handoffHistory = [
        ...state.handoffHistory,
        {
          from: currentAgent,
          to: targetAgent,
          reason,
          timestamp: new Date().toISOString()
        }
      ];
      
      if (runtime.context.verbose) {
        console.log(`🤝 Handoff: ${AGENT_DEFINITIONS[currentAgent].name} → ${AGENT_DEFINITIONS[targetAgent].name}`);
        console.log(`   Reason: ${reason}`);
      }
      
      // Remove handoff directive from message and add handoff note
      const cleanedContent = content.replace(/\n*HANDOFF_TO:[\s\S]+$/, '').trim();
      const handoffNote = `\n\n[Handing off to ${AGENT_DEFINITIONS[targetAgent].name}]`;
      
      // Jump back to model with new agent
      return controls.jumpTo('model', {
        currentAgent: targetAgent,
        handoffHistory,
        agentOutputs,
        messages: [
          ...messages.slice(0, -1),
          new AIMessage('assistant', cleanedContent + handoffNote),
          new BaseMessage('system', `You are now ${AGENT_DEFINITIONS[targetAgent].name}. Previous agent (${AGENT_DEFINITIONS[currentAgent].name}) handed off this task to you because: ${reason}`)
        ]
      });
    }
    
    // No handoff, just update outputs
    return { agentOutputs };
  }
});

// Example usage function
console.log('🐝 Swarm Agent Example\n');

// Create agent with swarm middleware
const agent = createAgent({
  middlewares: [swarmMiddleware] as const
});

// Example 1: Research and implementation task
const result = await agent.invoke(
  "I need to implement a caching solution for our API. Can you research the best options and provide implementation code?",
  {
    maxHandoffs: 5,
    verbose: true
  }
);

console.log('\n📊 Final State:');
console.log(`- Total handoffs: ${result.handoffHistory.length}`);
console.log(`- Agents involved: ${Object.keys(result.agentOutputs).join(', ')}`);
console.log('\n💬 Conversation:');
result.messages.forEach((msg, i) => {
  if (msg.role === 'user') {
    console.log(`\nUser: ${msg.content}`);
  } else if (msg instanceof AIMessage) {
    console.log(`\nAssistant: ${msg.content}`);
  }
});
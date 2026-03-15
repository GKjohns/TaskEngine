import type OpenAI from 'openai'
import type { Response, ResponseFormatTextJSONSchemaConfig } from 'openai/resources/responses/responses'
import type { Plan, PlanNode, PlanNodeType } from '../../shared/types/task-engine'

interface StructureNode {
  id: string
  type: PlanNodeType
  description: string
  per_artifact: boolean
  depends_on: string[]
}

const STRUCTURE_SCHEMA: ResponseFormatTextJSONSchemaConfig = {
  type: 'json_schema' as const,
  name: 'plan_structure',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'agent_transform',
                'agent_code',
                'llm_classify',
                'llm_extract',
                'llm_summarize',
                'llm_transform',
                'retrieve',
                'branch',
                'wait',
                'review',
                'emit',
                'notify'
              ]
            },
            description: { type: 'string' },
            per_artifact: { type: 'boolean' },
            depends_on: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['id', 'type', 'description', 'per_artifact', 'depends_on'],
          additionalProperties: false
        }
      }
    },
    required: ['nodes'],
    additionalProperties: false
  }
}

const STRUCTURE_INSTRUCTIONS = `You are a plan generator for Task Engine, a runtime that executes text-based work as directed acyclic graphs of nodes.

A plan is a reusable workflow template. Given a description of the desired workflow, generate a high-level execution plan as a JSON object with a "nodes" array. Each node has:
- id: a short, descriptive snake_case identifier
- type: one of the available node types
- description: one sentence explaining what this node does and why. Write descriptions generically so the plan can be reused with different input data.
- per_artifact: whether this node should process each input artifact individually (true) or all at once (false). Set to true when each artifact needs independent processing. Set to false when the node needs to see all inputs together.
- depends_on: array of node ids that must complete before this node runs

The user selects input artifacts when creating a task. These are automatically fed to root nodes (nodes with empty depends_on). Do NOT create retrieve nodes just to load the user's input data — that is handled automatically. Start the plan with the first processing step.

Only use retrieve nodes when the plan genuinely needs to dynamically search for or fetch additional context beyond the user's explicit inputs (e.g., "find related documents", "search for recent entries matching a criteria").

Available node types:

AGENT NODES:
- agent_transform: complex reasoning, analysis, drafting, research
- agent_code: generate and execute Python code

SIMPLE LLM NODES:
- llm_classify: classification, tagging, sentiment
- llm_extract: entity or data extraction
- llm_summarize: summarization
- llm_transform: rewriting, formatting, translation

INFRASTRUCTURE NODES:
- retrieve: dynamically search for or fetch additional context (NOT for loading the user's input artifacts)
- branch: conditional routing based on previous output
- wait: pause for a duration
- review: pause for human review
- emit: write an artifact to storage
- notify: log a message or send notification

Choose agent nodes for work requiring judgment, multi-step reasoning, or research. Choose simple LLM nodes for straightforward transforms where a single prompt-in/result-out call suffices. Use infrastructure nodes only when they clearly add value.

The plan should be minimal. Prefer fewer, more capable nodes over many granular ones.`

const NODE_CONFIG_SCHEMAS: Record<PlanNodeType, ResponseFormatTextJSONSchemaConfig> = {
  agent_transform: {
    type: 'json_schema',
    name: 'agent_transform_config',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' }
      },
      required: ['prompt'],
      additionalProperties: false
    }
  },
  agent_code: {
    type: 'json_schema',
    name: 'agent_code_config',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' }
      },
      required: ['prompt'],
      additionalProperties: false
    }
  },
  llm_classify: {
    type: 'json_schema',
    name: 'llm_classify_config',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        labels: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['prompt', 'labels'],
      additionalProperties: false
    }
  },
  llm_extract: {
    type: 'json_schema',
    name: 'llm_extract_config',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' }
      },
      required: ['prompt'],
      additionalProperties: false
    }
  },
  llm_summarize: {
    type: 'json_schema',
    name: 'llm_summarize_config',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        max_length: { type: 'number' }
      },
      required: ['prompt', 'max_length'],
      additionalProperties: false
    }
  },
  llm_transform: {
    type: 'json_schema',
    name: 'llm_transform_config',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' }
      },
      required: ['prompt'],
      additionalProperties: false
    }
  },
  retrieve: {
    type: 'json_schema',
    name: 'retrieve_config',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        filter: { type: ['string', 'null'] }
      },
      required: ['source', 'filter'],
      additionalProperties: false
    }
  },
  branch: {
    type: 'json_schema',
    name: 'branch_config',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        condition: { type: 'string' },
        if_true_node: { type: 'string' },
        if_false_node: { type: 'string' }
      },
      required: ['condition', 'if_true_node', 'if_false_node'],
      additionalProperties: false
    }
  },
  wait: {
    type: 'json_schema',
    name: 'wait_config',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        duration: { type: 'string' }
      },
      required: ['duration'],
      additionalProperties: false
    }
  },
  review: {
    type: 'json_schema',
    name: 'review_config',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' }
      },
      required: ['message'],
      additionalProperties: false
    }
  },
  emit: {
    type: 'json_schema',
    name: 'emit_config',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        format: {
          type: 'string',
          enum: ['markdown', 'text', 'json', 'csv']
        }
      },
      required: ['title', 'format'],
      additionalProperties: false
    }
  },
  notify: {
    type: 'json_schema',
    name: 'notify_config',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        level: {
          type: 'string',
          enum: ['info', 'warning', 'error']
        }
      },
      required: ['message', 'level'],
      additionalProperties: false
    }
  }
}

const NODE_CONFIG_INSTRUCTIONS = `You are filling in the configuration for a single node in a Task Engine execution plan.

Given the node's type, description, and the overall workflow context, generate the fields for this node. Be specific in prompts. Write the actual instructions the downstream model or runtime should use. Keep prompts generic enough that the plan can be reused with different input data.`

function getResponseText(response: Response) {
  if (response.output_text) {
    return response.output_text
  }

  throw new Error('OpenAI response did not include structured output text')
}

export async function generatePlan(openai: OpenAI, prompt: string): Promise<Plan> {
  const structureResponse = await openai.responses.create({
    model: 'gpt-5.4',
    instructions: STRUCTURE_INSTRUCTIONS,
    input: prompt,
    reasoning: { effort: 'high' },
    text: { format: STRUCTURE_SCHEMA }
  })

  const structure = JSON.parse(getResponseText(structureResponse)) as { nodes: StructureNode[] }

  const expandedNodes = await Promise.all(structure.nodes.map(async (node) => {
    const response = await openai.responses.create({
      model: 'gpt-5-mini',
      instructions: NODE_CONFIG_INSTRUCTIONS,
      input: [
        `Workflow: ${prompt}`,
        `Node ID: ${node.id}`,
        `Node type: ${node.type}`,
        `Description: ${node.description}`,
        `Per-artifact: ${node.per_artifact}`
      ].join('\n'),
      text: {
        format: NODE_CONFIG_SCHEMAS[node.type]
      }
    })

    return {
      ...node,
      ...JSON.parse(getResponseText(response))
    }
  }))

  const nullFields: Omit<PlanNode, 'id' | 'type' | 'description' | 'per_artifact' | 'depends_on'> = {
    prompt: null,
    labels: null,
    max_length: null,
    source: null,
    filter: null,
    condition: null,
    if_true_node: null,
    if_false_node: null,
    duration: null,
    message: null,
    title: null,
    format: null,
    level: null
  }

  return {
    nodes: expandedNodes.map(node => ({
      ...nullFields,
      ...node
    })) as PlanNode[]
  }
}

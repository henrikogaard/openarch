import { PROMPTS, renderPrompt } from '@openarch/ai';
import { createInterface } from 'node:readline';
import {
  RESOURCES,
  RESOURCE_TEMPLATES,
  ResourceNotFoundError,
  readResource,
} from './resources';
import { createModelStore, type ModelStore } from './store';
import { TOOLS, callTool } from './tools';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcError {
  code: number;
  message: string;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

const INITIALIZE_RESULT = {
  protocolVersion: '2025-06-18',
  capabilities: {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false },
    prompts: { listChanged: false },
  },
  serverInfo: { name: 'openarch', version: '0.2.0' },
  instructions:
    'OpenArch MCP: model ArchiMate 3.2 architectures. Read the aoef://format-guide and openarch://metamodel/elements resources before generating models. Prefer create_model_from_spec for new models.',
} as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeResponse(message: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorResponse(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function logToolCall(name: string, success: boolean, startedAt: number): void {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      event: 'tool.call',
      tool: name,
      success,
      durationMs: Date.now() - startedAt,
    })}\n`,
  );
}

function paramsOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function dispatch(request: JsonRpcRequest, store: ModelStore): Promise<JsonRpcResponse | null> {
  const { id, method, params } = request;
  const responseId = id ?? null;

  // Notifications never receive a response.
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return null;
  }

  try {
    let result: unknown;
    switch (method) {
      case 'initialize':
        result = INITIALIZE_RESULT;
        break;
      case 'ping':
        result = {};
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call': {
        const callParams = paramsOf(params);
        const name = typeof callParams.name === 'string' ? callParams.name : '';
        const startedAt = Date.now();
        let success = false;
        try {
          const toolResult = await callTool(name, callParams.arguments, store);
          success = toolResult.isError !== true;
          result = toolResult;
        } finally {
          logToolCall(name, success, startedAt);
        }
        break;
      }
      case 'resources/list':
        result = { resources: RESOURCES };
        break;
      case 'resources/read': {
        const uri = paramsOf(params).uri;
        if (typeof uri !== 'string') {
          return errorResponse(responseId, -32602, 'Invalid params: resources/read requires a uri string');
        }
        result = await readResource(uri, store);
        break;
      }
      case 'resources/templates/list':
        result = { resourceTemplates: RESOURCE_TEMPLATES };
        break;
      case 'prompts/list':
        result = {
          prompts: PROMPTS.map(({ name, description, arguments: args }) => ({
            name,
            description,
            ...(args ? { arguments: args } : {}),
          })),
        };
        break;
      case 'prompts/get': {
        const getParams = paramsOf(params);
        const name = typeof getParams.name === 'string' ? getParams.name : '';
        const args = paramsOf(getParams.arguments);
        const stringArgs: Record<string, string> = {};
        for (const [key, value] of Object.entries(args)) {
          stringArgs[key] = typeof value === 'string' ? value : String(value);
        }
        try {
          result = renderPrompt(name, stringArgs);
        } catch (error) {
          return errorResponse(responseId, -32602, errorMessage(error));
        }
        break;
      }
      default:
        return errorResponse(responseId, -32601, `Method not found: ${method}`);
    }

    // Requests without an id are notifications: acknowledge with no response.
    if (id === undefined) return null;
    return { jsonrpc: '2.0', id: responseId, result };
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return errorResponse(responseId, -32002, error.message);
    }
    return errorResponse(responseId, -32603, errorMessage(error));
  }
}

async function handleLine(line: string, store: ModelStore): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    writeResponse(errorResponse(null, -32700, 'Parse error'));
    return;
  }

  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    writeResponse(errorResponse(request.id ?? null, -32600, 'Invalid Request'));
    return;
  }

  const response = await dispatch(request, store);
  if (response) writeResponse(response);
}

let store: ModelStore;
try {
  store = createModelStore();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ts: new Date().toISOString(),
    event: 'store.error',
    message: errorMessage(error),
  })}\n`);
  process.exit(1);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const trimmed = line.trim();
  if (trimmed) await handleLine(trimmed, store);
}

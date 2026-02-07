export function anthropicToCodex(body: any): any {
  const codexRequest: any = {
    model: body.model || 'gpt-4o',
    store: false,
    stream: true,
    input: []
  };

  if (body.system) {
    codexRequest.instructions = extractSystemInstructions(body.system);
  }

  if (body.messages) {
    codexRequest.input = convertMessages(body.messages);
  }

  if (body.tools) {
    codexRequest.tools = convertTools(body.tools);
  }

  return codexRequest;
}

function extractSystemInstructions(system: any): string {
  if (typeof system === 'string') {
    return system;
  }

  if (Array.isArray(system)) {
    return system
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
  }

  return '';
}

function convertMessages(messages: any[]): any[] {
  const codexMessages: any[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      codexMessages.push(...convertUserMessage(message));
    } else if (message.role === 'assistant') {
      codexMessages.push(...convertAssistantMessage(message));
    }
  }

  return codexMessages;
}

function convertUserMessage(message: any): any[] {
  const results: any[] = [];

  if (typeof message.content === 'string') {
    results.push({
      type: 'message',
      role: 'user',
      content: message.content
    });
  } else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block.type === 'text') {
        results.push({
          type: 'message',
          role: 'user',
          content: block.text
        });
      } else if (block.type === 'tool_result') {
        results.push({
          type: 'function_call_output',
          call_id: block.tool_use_id,
          output: stringifyToolResult(block.content)
        });
      }
    }
  }

  return results;
}

function convertAssistantMessage(message: any): any[] {
  const results: any[] = [];

  if (typeof message.content === 'string') {
    results.push({
      type: 'message',
      role: 'assistant',
      content: message.content
    });
  } else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block.type === 'text') {
        results.push({
          type: 'message',
          role: 'assistant',
          content: block.text
        });
      } else if (block.type === 'tool_use') {
        results.push({
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input)
        });
      }
    }
  }

  return results;
}

function stringifyToolResult(content: any): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
  }

  return JSON.stringify(content);
}

const ALLOWED_SCHEMA_KEYS = new Set([
  'type', 'properties', 'required', 'additionalProperties',
  'items', 'enum', 'const', 'description', 'default',
  'anyOf', 'oneOf', '$ref', '$schema', 'title',
  'nullable'
]);

const CONSTRAINT_FORMATTERS: Record<string, (value: any) => string> = {
  format: (v) => `Format: ${v}`,
  pattern: (v) => `Pattern: ${v}`,
  minLength: (v) => `Min length: ${v}`,
  maxLength: (v) => `Max length: ${v}`,
  minimum: (v) => `Minimum: ${v}`,
  maximum: (v) => `Maximum: ${v}`,
  exclusiveMinimum: (v) => `Must be > ${v}`,
  exclusiveMaximum: (v) => `Must be < ${v}`,
  minItems: (v) => `Min items: ${v}`,
  maxItems: (v) => `Max items: ${v}`,
  multipleOf: (v) => `Multiple of: ${v}`,
  propertyNames: (v) => v?.type ? `Property names must be ${v.type}` : 'Has property name constraints',
  uniqueItems: (v) => v ? 'Items must be unique' : '',
};

function extractConstraintNotes(schema: any): string[] {
  const notes: string[] = [];
  for (const [key, formatter] of Object.entries(CONSTRAINT_FORMATTERS)) {
    if (key in schema) {
      const note = formatter(schema[key]);
      if (note) notes.push(note);
    }
  }
  return notes;
}

function appendConstraintsToDescription(schema: any, notes: string[]): string | undefined {
  if (notes.length === 0) return schema.description;
  const constraint = notes.join('. ') + '.';
  return schema.description
    ? `${schema.description} (${constraint})`
    : constraint;
}

function makeSchemaStrict(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(makeSchemaStrict);
  }

  const constraintNotes = extractConstraintNotes(schema);

  const result: any = {};
  const existingRequired = new Set(schema.required || []);

  for (const key of Object.keys(schema)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key) && key !== 'properties') {
      continue;
    }

    if (key === 'properties' && typeof schema[key] === 'object') {
      const allPropertyNames = Object.keys(schema[key]);
      const strictProperties: any = {};

      for (const propName of allPropertyNames) {
        const prop = makeSchemaStrict(schema[key][propName]);

        if (!existingRequired.has(propName) && prop.type) {
          prop.type = Array.isArray(prop.type)
            ? [...new Set([...prop.type, 'null'])]
            : [prop.type, 'null'];
        }

        strictProperties[propName] = prop;
      }

      result.properties = strictProperties;
      result.required = allPropertyNames;
      result.additionalProperties = false;
    } else if (key === 'required') {
      continue;
    } else if (key === 'anyOf' || key === 'oneOf') {
      result[key] = schema[key].map((s: any) => makeSchemaStrict(s));
    } else if (key === 'items') {
      result[key] = makeSchemaStrict(schema[key]);
    } else {
      result[key] = schema[key];
    }
  }

  const enrichedDescription = appendConstraintsToDescription(schema, constraintNotes);
  if (enrichedDescription) {
    result.description = enrichedDescription;
  }

  return result;
}

function convertTools(tools: any[]): any[] {
  return tools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
    strict: false
  }));
}

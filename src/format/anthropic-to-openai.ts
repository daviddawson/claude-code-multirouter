interface AnthropicMessage {
  role: string;
  content: string | Array<{
    type: string;
    text?: string;
    source?: {
      type: string;
      media_type: string;
      data: string;
    };
    tool_use_id?: string;
    content?: any;
    id?: string;
    name?: string;
    input?: any;
  }>;
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: any;
  cache_control?: any;
}

interface AnthropicToolChoice {
  type: string;
  name?: string;
}

interface OpenAIMessage {
  role: string;
  content: string | null | Array<{
    type: string;
    text?: string;
    image_url?: {
      url: string;
    };
  }>;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

function stripCacheControl(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(stripCacheControl);
  }
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      if (key !== 'cache_control') {
        result[key] = stripCacheControl(obj[key]);
      }
    }
    return result;
  }
  return obj;
}

function convertSystemMessage(system: string | any[]): OpenAIMessage {
  if (typeof system === 'string') {
    return { role: 'system', content: system };
  }

  const textBlocks = system
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  return { role: 'system', content: textBlocks };
}

function convertUserMessage(content: string | any[]): OpenAIMessage {
  if (typeof content === 'string') {
    return { role: 'user', content };
  }

  const hasImages = content.some(block => block.type === 'image');

  if (!hasImages) {
    const text = content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    return { role: 'user', content: text };
  }

  const contentArray = content.map(block => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
    if (block.type === 'image' && block.source?.type === 'base64') {
      const dataUrl = `data:${block.source.media_type};base64,${block.source.data}`;
      return { type: 'image_url', image_url: { url: dataUrl } };
    }
    return null;
  }).filter(Boolean);

  return { role: 'user', content: contentArray as any };
}

function convertAssistantMessage(content: string | any[]): OpenAIMessage {
  if (typeof content === 'string') {
    return { role: 'assistant', content };
  }

  const textBlocks = content.filter(block => block.type === 'text');
  const toolUseBlocks = content.filter(block => block.type === 'tool_use');

  const textContent = textBlocks.map(block => block.text).join('\n');

  if (toolUseBlocks.length === 0) {
    return { role: 'assistant', content: textContent || null };
  }

  const toolCalls = toolUseBlocks.map(block => ({
    id: block.id,
    type: 'function',
    function: {
      name: block.name,
      arguments: JSON.stringify(block.input)
    }
  }));

  return {
    role: 'assistant',
    content: textContent || null,
    tool_calls: toolCalls
  };
}

function convertToolResultMessage(content: any[]): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];
  const textParts: string[] = [];

  for (const block of content) {
    if (block.type === 'tool_result') {
      messages.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content)
      });
    } else if (block.type === 'text' && block.text) {
      textParts.push(block.text);
    }
  }

  if (textParts.length > 0) {
    messages.push({ role: 'user', content: textParts.join('\n') });
  }

  return messages;
}

function convertMessages(messages: AnthropicMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      if (Array.isArray(message.content) &&
          message.content.some((block: any) => block.type === 'tool_result')) {
        result.push(...convertToolResultMessage(message.content));
      } else {
        result.push(convertUserMessage(message.content));
      }
    } else if (message.role === 'assistant') {
      result.push(convertAssistantMessage(message.content));
    }
  }

  return result;
}

function convertTools(tools: AnthropicTool[]) {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: stripCacheControl(tool.input_schema)
    }
  }));
}

function convertToolChoice(toolChoice: AnthropicToolChoice): any {
  if (toolChoice.type === 'auto') {
    return 'auto';
  }
  if (toolChoice.type === 'any') {
    return 'required';
  }
  if (toolChoice.type === 'tool' && toolChoice.name) {
    return {
      type: 'function',
      function: { name: toolChoice.name }
    };
  }
  return undefined;
}

export function anthropicToOpenAI(body: any): any {
  const result: any = { messages: [] };

  if (body.system) {
    result.messages.push(convertSystemMessage(body.system));
  }

  if (body.messages) {
    result.messages.push(...convertMessages(body.messages));
  }

  if (body.tools) {
    result.tools = convertTools(body.tools);
  }

  if (body.tool_choice) {
    const converted = convertToolChoice(body.tool_choice);
    if (converted !== undefined) {
      result.tool_choice = converted;
    }
  }

  if (body.max_tokens !== undefined) {
    result.max_tokens = body.max_tokens;
  }

  if (body.temperature !== undefined) {
    result.temperature = body.temperature;
  }

  if (body.stream !== undefined) {
    result.stream = body.stream;
  }

  if (body.top_p !== undefined) {
    result.top_p = body.top_p;
  }

  if (body.stop_sequences) {
    result.stop = body.stop_sequences;
  }

  return result;
}

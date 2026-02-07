interface StreamState {
  messageStartEmitted: boolean;
  currentBlockIndex: number;
  currentBlockType: string | null;
  currentToolCallId: string | null;
  inputTokens: number;
  outputTokens: number;
}

export class OpenAIToAnthropicStream {
  private state: StreamState;
  private model: string;

  constructor(model: string) {
    this.model = model;
    this.state = {
      messageStartEmitted: false,
      currentBlockIndex: 0,
      currentBlockType: null,
      currentToolCallId: null,
      inputTokens: 0,
      outputTokens: 0
    };
  }

  processChunk(eventData: string): string[] {
    if (eventData.trim() === '[DONE]') {
      return this.emitStreamEnd();
    }

    let parsed: any;
    try {
      parsed = JSON.parse(eventData);
    } catch {
      return [];
    }

    const events: string[] = [];

    if (!this.state.messageStartEmitted) {
      events.push(...this.emitMessageStart(parsed));
    }

    const delta = parsed.choices?.[0]?.delta;
    if (!delta) {
      return events;
    }

    if (delta.content) {
      events.push(...this.emitTextContent(delta.content));
    }

    if (delta.tool_calls) {
      events.push(...this.emitToolCalls(delta.tool_calls));
    }

    const finishReason = parsed.choices?.[0]?.finish_reason;
    if (finishReason) {
      events.push(...this.emitFinish(finishReason, parsed.usage));
    }

    if (parsed.usage) {
      this.updateUsage(parsed.usage);
    }

    return events;
  }

  private emitMessageStart(parsed: any): string[] {
    this.state.messageStartEmitted = true;

    if (parsed.usage?.prompt_tokens) {
      this.state.inputTokens = parsed.usage.prompt_tokens;
    }

    const messageStart = {
      type: 'message_start',
      message: {
        id: 'msg_proxy',
        type: 'message',
        role: 'assistant',
        content: [],
        model: this.model,
        stop_reason: null,
        usage: {
          input_tokens: this.state.inputTokens,
          output_tokens: 0
        }
      }
    };

    return [this.formatEvent('message_start', messageStart)];
  }

  private emitTextContent(content: string): string[] {
    const events: string[] = [];

    if (this.state.currentBlockType !== 'text') {
      if (this.state.currentBlockType !== null) {
        events.push(this.emitContentBlockStop());
      }

      const blockStart = {
        type: 'content_block_start',
        index: this.state.currentBlockIndex,
        content_block: {
          type: 'text',
          text: ''
        }
      };
      events.push(this.formatEvent('content_block_start', blockStart));

      this.state.currentBlockType = 'text';
      this.state.currentBlockIndex++;
    }

    const blockDelta = {
      type: 'content_block_delta',
      index: this.state.currentBlockIndex - 1,
      delta: {
        type: 'text_delta',
        text: content
      }
    };
    events.push(this.formatEvent('content_block_delta', blockDelta));

    return events;
  }

  private emitToolCalls(toolCalls: any[]): string[] {
    const events: string[] = [];

    for (const toolCall of toolCalls) {
      if (toolCall.id) {
        if (this.state.currentBlockType !== null) {
          events.push(this.emitContentBlockStop());
        }

        const blockStart = {
          type: 'content_block_start',
          index: this.state.currentBlockIndex,
          content_block: {
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function?.name || ''
          }
        };
        events.push(this.formatEvent('content_block_start', blockStart));

        this.state.currentBlockType = 'tool_use';
        this.state.currentToolCallId = toolCall.id;
        this.state.currentBlockIndex++;
      }

      if (toolCall.function?.arguments) {
        const blockDelta = {
          type: 'content_block_delta',
          index: this.state.currentBlockIndex - 1,
          delta: {
            type: 'input_json_delta',
            partial_json: toolCall.function.arguments
          }
        };
        events.push(this.formatEvent('content_block_delta', blockDelta));
      }
    }

    return events;
  }

  private emitFinish(finishReason: string, usage: any): string[] {
    const events: string[] = [];

    if (this.state.currentBlockType !== null) {
      events.push(this.emitContentBlockStop());
    }

    const stopReason = this.mapFinishReason(finishReason);

    if (usage?.completion_tokens) {
      this.state.outputTokens = usage.completion_tokens;
    }

    const messageDelta = {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason
      },
      usage: {
        output_tokens: this.state.outputTokens
      }
    };
    events.push(this.formatEvent('message_delta', messageDelta));

    const messageStop = {
      type: 'message_stop'
    };
    events.push(this.formatEvent('message_stop', messageStop));

    return events;
  }

  private emitStreamEnd(): string[] {
    const events: string[] = [];

    if (this.state.currentBlockType !== null) {
      events.push(this.emitContentBlockStop());
    }

    const messageDelta = {
      type: 'message_delta',
      delta: {
        stop_reason: 'end_turn'
      },
      usage: {
        output_tokens: this.state.outputTokens
      }
    };
    events.push(this.formatEvent('message_delta', messageDelta));

    const messageStop = {
      type: 'message_stop'
    };
    events.push(this.formatEvent('message_stop', messageStop));

    return events;
  }

  private emitContentBlockStop(): string {
    const blockStop = {
      type: 'content_block_stop',
      index: this.state.currentBlockIndex - 1
    };

    this.state.currentBlockType = null;
    this.state.currentToolCallId = null;

    return this.formatEvent('content_block_stop', blockStop);
  }

  private mapFinishReason(reason: string): string {
    const mapping: Record<string, string> = {
      'stop': 'end_turn',
      'tool_calls': 'tool_use',
      'length': 'max_tokens'
    };
    return mapping[reason] || 'end_turn';
  }

  private updateUsage(usage: any): void {
    if (usage.prompt_tokens) {
      this.state.inputTokens = usage.prompt_tokens;
    }
    if (usage.completion_tokens) {
      this.state.outputTokens = usage.completion_tokens;
    }
  }

  private formatEvent(eventType: string, data: any): string {
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  }
}

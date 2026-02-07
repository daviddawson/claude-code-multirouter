interface StreamState {
  messageStarted: boolean;
  currentBlockIndex: number;
  currentBlockType: string | null;
  messageId: string | null;
  hasToolCalls: boolean;
}

export class CodexToAnthropicStream {
  private model: string;
  private state: StreamState;

  constructor(model: string) {
    this.model = model;
    this.state = {
      messageStarted: false,
      currentBlockIndex: -1,
      currentBlockType: null,
      messageId: null,
      hasToolCalls: false
    };
  }

  processChunk(eventData: string): string[] {
    const events: string[] = [];
    let data: any;
    try {
      data = JSON.parse(eventData);
    } catch {
      return [];
    }

    if (data.type === 'response.created') {
      events.push(...this.handleResponseCreated(data));
    } else if (data.type === 'response.output_text.delta') {
      events.push(...this.handleTextDelta(data));
    } else if (data.type === 'response.output_item.added' && data.item?.type === 'function_call') {
      events.push(...this.handleFunctionCallAdded(data));
    } else if (data.type === 'response.function_call_arguments.delta') {
      events.push(...this.handleFunctionArgumentsDelta(data));
    } else if (data.type === 'response.output_item.done') {
      events.push(...this.handleOutputItemDone());
    } else if (data.type === 'response.completed') {
      events.push(...this.handleResponseCompleted(data));
    }

    return events;
  }

  private handleResponseCreated(data: any): string[] {
    this.state.messageStarted = true;
    this.state.messageId = data.response?.id || `msg_${Date.now()}`;

    const messageStart = {
      type: 'message_start',
      message: {
        id: this.state.messageId,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0
        }
      }
    };

    return [this.formatSSE('message_start', messageStart)];
  }

  private handleTextDelta(data: any): string[] {
    const events: string[] = [];

    if (this.state.currentBlockType !== 'text') {
      if (this.state.currentBlockType !== null) {
        events.push(this.formatSSE('content_block_stop', {
          type: 'content_block_stop',
          index: this.state.currentBlockIndex
        }));
      }

      this.state.currentBlockIndex++;
      this.state.currentBlockType = 'text';

      events.push(this.formatSSE('content_block_start', {
        type: 'content_block_start',
        index: this.state.currentBlockIndex,
        content_block: {
          type: 'text',
          text: ''
        }
      }));
    }

    events.push(this.formatSSE('content_block_delta', {
      type: 'content_block_delta',
      index: this.state.currentBlockIndex,
      delta: {
        type: 'text_delta',
        text: data.delta
      }
    }));

    return events;
  }

  private handleFunctionCallAdded(data: any): string[] {
    const events: string[] = [];

    if (this.state.currentBlockType !== null) {
      events.push(this.formatSSE('content_block_stop', {
        type: 'content_block_stop',
        index: this.state.currentBlockIndex
      }));
    }

    this.state.currentBlockIndex++;
    this.state.currentBlockType = 'tool_use';
    this.state.hasToolCalls = true;

    events.push(this.formatSSE('content_block_start', {
      type: 'content_block_start',
      index: this.state.currentBlockIndex,
      content_block: {
        type: 'tool_use',
        id: data.item.call_id,
        name: data.item.name,
        input: {}
      }
    }));

    return events;
  }

  private handleFunctionArgumentsDelta(data: any): string[] {
    return [this.formatSSE('content_block_delta', {
      type: 'content_block_delta',
      index: this.state.currentBlockIndex,
      delta: {
        type: 'input_json_delta',
        partial_json: data.delta
      }
    })];
  }

  private handleOutputItemDone(): string[] {
    if (this.state.currentBlockType === null) {
      return [];
    }

    const event = this.formatSSE('content_block_stop', {
      type: 'content_block_stop',
      index: this.state.currentBlockIndex
    });

    this.state.currentBlockType = null;
    return [event];
  }

  private handleResponseCompleted(data: any): string[] {
    const events: string[] = [];

    if (this.state.currentBlockType !== null) {
      events.push(this.formatSSE('content_block_stop', {
        type: 'content_block_stop',
        index: this.state.currentBlockIndex
      }));
      this.state.currentBlockType = null;
    }

    const stopReason = this.determineStopReason(data);
    const usage = this.extractUsage(data);

    events.push(this.formatSSE('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
        stop_sequence: null
      },
      usage: {
        output_tokens: usage.output_tokens
      }
    }));

    events.push(this.formatSSE('message_stop', {
      type: 'message_stop'
    }));

    return events;
  }

  private determineStopReason(data: any): string {
    if (this.state.hasToolCalls) {
      return 'tool_use';
    }

    const finishReason = data.response?.status;
    if (finishReason === 'completed') {
      return 'end_turn';
    }

    return 'end_turn';
  }

  private extractUsage(data: any): { input_tokens: number; output_tokens: number } {
    const usage = data.response?.usage || {};
    return {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0
    };
  }

  private formatSSE(event: string, data: any): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }
}

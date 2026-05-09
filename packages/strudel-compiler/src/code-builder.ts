export interface SourceMapEntry {
  start: number;
  end: number;
  graphPath: string;
}

export class CodeBuilder {
  private chunks: string[] = [];
  private pos = 0;
  private map: SourceMapEntry[] = [];

  emit(text: string, graphPath?: string): this {
    if (graphPath) {
      this.map.push({ start: this.pos, end: this.pos + text.length, graphPath });
    }
    this.chunks.push(text);
    this.pos += text.length;
    return this;
  }

  newline(): this {
    return this.emit('\n');
  }

  build(): { code: string; sourceMap: SourceMapEntry[] } {
    return { code: this.chunks.join(''), sourceMap: this.map };
  }
}

export function quoteJsString(s: string): string {
  return JSON.stringify(s);
}

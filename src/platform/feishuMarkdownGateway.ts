import type {
  NoteMarkdownParseResult,
  NoteMarkdownRenderOptions,
  NoteMarkdownRenderResult,
  NotePlatformMarkdownGateway,
} from "./types.js";
import {
  parseMarkdownToNestedBlocks,
  renderBlocksToMarkdown,
} from "./feishuMarkdownCodec.js";

export class FeishuNotePlatformMarkdownGateway
  implements NotePlatformMarkdownGateway
{
  parseMarkdownToNestedBlocks(markdown: string): NoteMarkdownParseResult {
    return parseMarkdownToNestedBlocks(markdown);
  }

  renderBlocksToMarkdown(
    blocks: Array<Record<string, unknown>>,
    options: NoteMarkdownRenderOptions = {},
  ): NoteMarkdownRenderResult {
    return renderBlocksToMarkdown(blocks, options);
  }
}

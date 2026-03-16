export { MarkdownDocumentService } from "./service.js";
export type {
  ExportMarkdownInput,
  ImportMarkdownInput,
} from "./service.js";

export {
  parseMarkdownToBlocks,
  parseMarkdownToFeishuBlocks,
  parseMarkdownToNestedBlocks,
  renderBlocksToMarkdown,
  renderFeishuBlocksToMarkdown,
} from "../../platform/feishuMarkdownCodec.js";
export type {
  MarkdownParseResult,
  NestedMarkdownBlock,
  MarkdownRenderOptions,
  MarkdownRenderResult,
  NestedFeishuBlock,
  NestedMarkdownParseResult,
} from "../../platform/feishuMarkdownCodec.js";

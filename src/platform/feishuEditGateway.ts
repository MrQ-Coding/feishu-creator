import type { FeishuClient } from "../feishu/client.js";
import type {
  NoteCreateBlockChildrenResult,
  NotePlatformEditGateway,
  NoteUpdateBlockTextResult,
} from "./types.js";

interface CreateBlockChildrenResponse {
  children?: Array<Record<string, unknown>>;
  document_revision_id?: number;
  client_token?: string;
}

interface UpdateBlockTextResponse {
  document_revision_id?: number;
}

export class FeishuNotePlatformEditGateway implements NotePlatformEditGateway {
  constructor(private readonly feishuClient: FeishuClient) {}

  async createBlockChildren(options: {
    documentId: string;
    parentBlockId: string;
    children: Array<Record<string, unknown>>;
    index?: number;
    documentRevisionId?: number;
    clientToken?: string;
  }): Promise<NoteCreateBlockChildrenResult> {
    const body: Record<string, unknown> = {
      children: options.children,
    };
    if (options.index !== undefined) {
      body.index = options.index;
    }
    const data = await this.feishuClient.request<CreateBlockChildrenResponse>(
      `/docx/v1/documents/${options.documentId}/blocks/${options.parentBlockId}/children`,
      "POST",
      body,
      {
        document_revision_id: options.documentRevisionId,
        client_token: options.clientToken,
      },
    );
    return {
      children: Array.isArray(data.children) ? data.children : [],
      documentRevisionId: data.document_revision_id,
      clientToken: data.client_token,
    };
  }

  async deleteBlockChildrenRange(options: {
    documentId: string;
    parentBlockId: string;
    startIndex: number;
    endIndex: number;
    documentRevisionId?: number;
    clientToken?: string;
  }): Promise<void> {
    await this.feishuClient.request(
      `/docx/v1/documents/${options.documentId}/blocks/${options.parentBlockId}/children/batch_delete`,
      "DELETE",
      {
        start_index: options.startIndex,
        end_index: options.endIndex,
      },
      {
        document_revision_id: options.documentRevisionId,
        client_token: options.clientToken,
      },
    );
  }

  async updateBlockText(options: {
    documentId: string;
    blockId: string;
    elements: Array<Record<string, unknown>>;
    documentRevisionId?: number;
  }): Promise<NoteUpdateBlockTextResult> {
    const data = await this.feishuClient.request<UpdateBlockTextResponse>(
      `/docx/v1/documents/${options.documentId}/blocks/${options.blockId}`,
      "PATCH",
      {
        update_text_elements: {
          elements: options.elements,
        },
      },
      {
        document_revision_id: options.documentRevisionId,
      },
    );
    return {
      documentRevisionId: data.document_revision_id,
    };
  }
}

import type { FeishuClient } from "../feishu/client.js";
import type {
  NotePlatformMediaGateway,
  NoteUploadImageToBlockResult,
} from "./types.js";

interface UploadMediaResponse {
  file_token?: string;
}

interface UpdateImageBlockResponse {
  document_revision_id?: number;
}

export class FeishuNotePlatformMediaGateway implements NotePlatformMediaGateway {
  constructor(private readonly feishuClient: FeishuClient) {}

  async downloadMediaByToken(token: string) {
    return this.feishuClient.requestBinary(`/drive/v1/medias/${token}/download`, "GET");
  }

  async uploadImageToBlock(options: {
    documentId: string;
    imageBlockId: string;
    imageBytes: Buffer;
    fileName: string;
    mimeType: string;
    width: number;
    height: number;
    documentRevisionId?: number;
  }): Promise<NoteUploadImageToBlockResult> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(options.imageBytes)], {
      type: options.mimeType,
    });
    formData.append("file", blob, options.fileName);
    formData.append("file_name", options.fileName);
    formData.append("parent_type", "docx_image");
    formData.append("parent_node", options.imageBlockId);
    formData.append("size", String(options.imageBytes.byteLength));

    const uploadResult = await this.feishuClient.request<UploadMediaResponse>(
      "/drive/v1/medias/upload_all",
      "POST",
      formData,
    );
    const fileToken = uploadResult.file_token?.trim();
    if (!fileToken) {
      throw new Error("Image upload failed: response missing file_token.");
    }

    const bindResult = await this.feishuClient.request<UpdateImageBlockResponse>(
      `/docx/v1/documents/${options.documentId}/blocks/${options.imageBlockId}`,
      "PATCH",
      {
        replace_image: {
          token: fileToken,
          width: options.width,
          height: options.height,
        },
      },
      {
        document_revision_id: options.documentRevisionId,
      },
    );

    return {
      fileToken,
      documentRevisionId: bindResult.document_revision_id,
    };
  }
}

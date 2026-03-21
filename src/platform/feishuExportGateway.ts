import type { FeishuClient } from '../feishu/client.js';
import type {
  NoteDownloadedMedia,
  NoteExportFileExtension,
  NoteExportTaskResult,
  NoteExportTaskStatus,
  NotePlatformExportGateway,
} from './types.js';

interface CreateExportTaskResponse {
  ticket?: string;
}

interface GetExportTaskResponse {
  result?: {
    file_extension?: string;
    type?: string;
    file_name?: string;
    file_token?: string;
    file_size?: number;
    job_status?: number;
    job_error_msg?: string;
  };
}

export class FeishuNotePlatformExportGateway implements NotePlatformExportGateway {
  constructor(private readonly feishuClient: FeishuClient) {}

  async createExportTask(
    documentToken: string,
    fileExtension: NoteExportFileExtension,
    documentType = 'docx',
  ): Promise<NoteExportTaskResult> {
    const response = await this.feishuClient.request<CreateExportTaskResponse>(
      '/drive/v1/export_tasks',
      'POST',
      {
        file_extension: fileExtension,
        token: documentToken,
        type: documentType,
      },
    );
    const ticket = response.ticket;
    if (!ticket) {
      throw new Error('Export task creation failed: response missing ticket.');
    }
    return { ticket };
  }

  async getExportTaskStatus(
    ticket: string,
    documentToken: string,
  ): Promise<NoteExportTaskStatus> {
    const response = await this.feishuClient.request<GetExportTaskResponse>(
      `/drive/v1/export_tasks/${ticket}`,
      'GET',
      undefined,
      { token: documentToken },
    );
    const result = response.result;
    if (!result) {
      throw new Error('Export task query failed: response missing result.');
    }
    return {
      fileExtension: result.file_extension ?? '',
      type: result.type ?? '',
      fileName: result.file_name ?? '',
      fileToken: result.file_token ?? '',
      fileSize: result.file_size ?? 0,
      jobStatus: result.job_status ?? -1,
      jobErrorMsg: result.job_error_msg ?? '',
    };
  }

  async downloadExportFile(fileToken: string): Promise<NoteDownloadedMedia> {
    return this.feishuClient.requestBinary(
      `/drive/v1/export_tasks/file/${fileToken}/download`,
      'GET',
    );
  }
}

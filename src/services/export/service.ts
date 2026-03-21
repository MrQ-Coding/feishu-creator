import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Logger } from '../../logger.js';
import type {
  NoteExportFileExtension,
  NotePlatformExportGateway,
  NotePlatformProvider,
} from '../../platform/index.js';

export interface ExportDocumentInput {
  documentId: string;
  fileExtension: NoteExportFileExtension;
  outputPath?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface ExportDocumentResult {
  filePath: string;
  fileName: string;
  fileSize: number;
  fileExtension: string;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 120_000;

export class DocumentExportService {
  constructor(
    private readonly notePlatformProvider: NotePlatformProvider,
    private readonly notePlatformExportGateway: NotePlatformExportGateway,
  ) {}

  async exportDocument(input: ExportDocumentInput): Promise<ExportDocumentResult> {
    const documentToken = this.requireDocumentId(input.documentId);
    const pollInterval = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Step 1: Create export task
    Logger.info(`Creating export task: document=${documentToken}, format=${input.fileExtension}`);
    const { ticket } = await this.notePlatformExportGateway.createExportTask(
      documentToken,
      input.fileExtension,
    );
    Logger.info(`Export task created: ticket=${ticket}`);

    // Step 2: Poll until complete
    const startTime = Date.now();
    while (true) {
      const status = await this.notePlatformExportGateway.getExportTaskStatus(
        ticket,
        documentToken,
      );

      if (status.jobStatus === 0) {
        // Success — download the file
        Logger.info(`Export task completed: file=${status.fileName}, size=${status.fileSize}`);
        const media = await this.notePlatformExportGateway.downloadExportFile(status.fileToken);

        const fileName = status.fileName
          ? `${status.fileName}.${input.fileExtension}`
          : `export_${documentToken}.${input.fileExtension}`;
        const filePath = input.outputPath ?? join(tmpdir(), fileName);

        await writeFile(filePath, media.body);
        Logger.info(`Export file saved: ${filePath}`);

        return {
          filePath,
          fileName,
          fileSize: status.fileSize,
          fileExtension: input.fileExtension,
        };
      }

      if (status.jobStatus >= 3) {
        throw new Error(
          `Export task failed (status=${status.jobStatus}): ${status.jobErrorMsg || 'unknown error'}`,
        );
      }

      if (Date.now() - startTime > timeout) {
        throw new Error(
          `Export task timed out after ${timeout}ms (status=${status.jobStatus})`,
        );
      }

      await delay(pollInterval);
    }
  }

  private requireDocumentId(documentId: string): string {
    const normalized = this.notePlatformProvider.extractDocumentId(documentId);
    if (!normalized) {
      throw new Error(`Invalid document ID or URL: ${documentId}`);
    }
    return normalized;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

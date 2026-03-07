import { detectDocumentType, extractDocumentId } from '../../feishu/document.js';
import type { DocumentEditRuntime } from './context.js';
import { deleteChildrenRange } from './blockMutations.js';
import { isNotFoundError, isPermissionDeniedError } from './helpers.js';
import type { DeleteDocumentInput, DeleteDocumentResult, WikiNodeLookupResponse } from './types.js';

export async function deleteDocumentCore(
  runtime: DocumentEditRuntime,
  input: DeleteDocumentInput,
): Promise<DeleteDocumentResult> {
  const sourceDocumentId = input.documentId?.trim();
  if (!sourceDocumentId) {
    throw new Error('documentId is required.');
  }

  let sourceType = input.documentType ?? detectDocumentType(sourceDocumentId);
  let wikiBindingFromNodeToken: { nodeToken?: string; spaceId?: string; title?: string } | null =
    null;
  if (
    !input.documentType &&
    sourceType === 'document' &&
    isLikelyRawToken(sourceDocumentId)
  ) {
    wikiBindingFromNodeToken = await probeWikiNodeByNodeToken(runtime, sourceDocumentId);
    if (wikiBindingFromNodeToken) {
      sourceType = 'wiki';
    }
  }
  const ignoreNotFound = input.ignoreNotFound ?? false;
  let deletedDocumentId: string;
  try {
    deletedDocumentId = await resolveDocumentIdForDelete(
      runtime,
      sourceDocumentId,
      sourceType,
    );
  } catch (error) {
    if (ignoreNotFound && isNotFoundError(error)) {
      return {
        sourceType,
        sourceDocumentId,
        deletedDocumentId: sourceDocumentId,
        deleted: false,
        notFound: true,
      };
    }
    throw error;
  }

  const wikiBinding =
    sourceType === 'wiki'
      ? (wikiBindingFromNodeToken ??
        (await lookupWikiNodeByNodeToken(runtime, sourceDocumentId)))
      : await lookupWikiNodeByDocxToken(runtime, deletedDocumentId);
  if (sourceType === 'wiki' || wikiBinding) {
    if (runtime.config.wikiDeleteStrategy === 'playwright') {
      const nodeToken = wikiBinding?.nodeToken ?? sourceDocumentId;
      if (!nodeToken) {
        throw new Error('Cannot resolve wiki node token for Playwright deletion.');
      }
      await runtime.wikiBrowserDeletionService.deleteWikiNode({
        nodeToken,
        spaceId: wikiBinding?.spaceId,
        title: wikiBinding?.title,
      });
      runtime.invalidateDocumentState(deletedDocumentId);
      runtime.documentInfoService.invalidateByPrefix('wiki');
      runtime.locateCache.invalidatePrefix(`locate:${deletedDocumentId}:`);
      return {
        sourceType,
        sourceDocumentId,
        deletedDocumentId,
        deleted: true,
        notFound: false,
        deletionMode: 'playwright',
        note: 'Wiki node deleted through built-in Playwright automation.',
      };
    }

    const clearedBlockCount = await clearDocumentContent(runtime, deletedDocumentId);
    if (sourceType === 'wiki' || wikiBinding) {
      runtime.documentInfoService.invalidateByPrefix('wiki');
      runtime.locateCache.invalidatePrefix(`locate:${deletedDocumentId}:`);
    }
    return {
      sourceType,
      sourceDocumentId,
      deletedDocumentId,
      deleted: false,
      notFound: false,
      deletionMode: 'clear_content',
      clearedBlockCount,
      note:
        'Document is wiki-backed. OpenAPI cannot delete wiki node; content has been cleared instead.',
    };
  }

  try {
    const data = await runtime.feishuClient.request<{ task_id?: string }>(
      `/drive/v1/files/${deletedDocumentId}`,
      'DELETE',
      undefined,
      { type: 'docx' },
    );
    runtime.invalidateDocumentState(deletedDocumentId);

    return {
      sourceType,
      sourceDocumentId,
      deletedDocumentId,
      deleted: true,
      notFound: false,
      deletionMode: 'hard_delete',
      taskId: data.task_id,
    };
  } catch (error) {
    if (ignoreNotFound && isNotFoundError(error)) {
      return {
        sourceType,
        sourceDocumentId,
        deletedDocumentId,
        deleted: false,
        notFound: true,
      };
    }
    if (isPermissionDeniedError(error)) {
      const clearedBlockCount = await clearDocumentContent(runtime, deletedDocumentId);
      return {
        sourceType,
        sourceDocumentId,
        deletedDocumentId,
        deleted: false,
        notFound: false,
        deletionMode: 'clear_content',
        clearedBlockCount,
        note: 'Drive hard delete is forbidden; content has been cleared instead.',
      };
    }
    throw error;
  }
}

function isLikelyRawToken(value: string): boolean {
  return /^[a-zA-Z0-9_-]{10,}$/.test(value);
}

async function resolveDocumentId(
  runtime: DocumentEditRuntime,
  inputId: string,
  sourceType: 'document' | 'wiki',
): Promise<string> {
  if (sourceType === 'document') {
    const normalized = extractDocumentId(inputId);
    if (!normalized) {
      throw new Error('Invalid document ID or document URL.');
    }
    return normalized;
  }

  const info = await runtime.documentInfoService.getDocumentInfo(inputId, 'wiki');
  const fromInfo =
    typeof info.documentId === 'string'
      ? info.documentId
      : typeof info.obj_token === 'string'
        ? info.obj_token
        : '';
  const normalized = extractDocumentId(fromInfo) ?? fromInfo;
  if (!normalized) {
    throw new Error('Cannot resolve document ID from wiki node.');
  }
  return normalized;
}

export async function resolveDocumentIdForDelete(
  runtime: DocumentEditRuntime,
  inputId: string,
  sourceType: 'document' | 'wiki',
): Promise<string> {
  return resolveDocumentId(runtime, inputId, sourceType);
}

async function lookupWikiNodeByDocxToken(
  runtime: DocumentEditRuntime,
  documentId: string,
): Promise<{ nodeToken?: string; spaceId?: string; title?: string } | null> {
  try {
    const data = await runtime.feishuClient.request<WikiNodeLookupResponse>(
      '/wiki/v2/spaces/get_node',
      'GET',
      undefined,
      {
        token: documentId,
        obj_type: 'docx',
      },
    );
    if (!data.node) return null;
    return {
      nodeToken: data.node.node_token,
      spaceId: data.node.space_id,
      title: data.node.title,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function lookupWikiNodeByNodeToken(
  runtime: DocumentEditRuntime,
  nodeToken: string,
): Promise<{ nodeToken?: string; spaceId?: string; title?: string } | null> {
  try {
    const info = await runtime.documentInfoService.getDocumentInfo(nodeToken, 'wiki');
    return {
      nodeToken,
      spaceId: typeof info.space_id === 'string' ? info.space_id : undefined,
      title: typeof info.title === 'string' ? info.title : undefined,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { nodeToken };
    }
    throw error;
  }
}

async function probeWikiNodeByNodeToken(
  runtime: DocumentEditRuntime,
  nodeToken: string,
): Promise<{ nodeToken?: string; spaceId?: string; title?: string } | null> {
  try {
    const info = await runtime.documentInfoService.getDocumentInfo(nodeToken, 'wiki');
    return {
      nodeToken,
      spaceId: typeof info.space_id === 'string' ? info.space_id : undefined,
      title: typeof info.title === 'string' ? info.title : undefined,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function clearDocumentContent(
  runtime: DocumentEditRuntime,
  documentId: string,
): Promise<number> {
  const children = await runtime.documentBlockService.getAllChildren(documentId, documentId, 500);
  const total = children.length;
  if (total <= 0) return 0;
  await deleteChildrenRange(runtime, documentId, documentId, 0, total, -1);
  runtime.documentInfoService.invalidateDocument(documentId);
  return total;
}

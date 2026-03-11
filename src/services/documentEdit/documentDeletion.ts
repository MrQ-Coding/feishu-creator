import {
  detectDocumentType,
  extractDocumentId,
  extractWikiToken,
} from '../../feishu/document.js';
import type { DocumentEditRuntime } from './context.js';
import { isNotFoundError } from './helpers.js';
import type { DeleteDocumentInput, DeleteDocumentResult } from './types.js';

export async function deleteDocumentCore(
  runtime: DocumentEditRuntime,
  input: DeleteDocumentInput,
): Promise<DeleteDocumentResult> {
  const sourceDocumentId = input.documentId?.trim();
  if (!sourceDocumentId) {
    throw new Error('documentId is required.');
  }

  const sourceType = input.documentType ?? detectDocumentType(sourceDocumentId);
  const ignoreNotFound = input.ignoreNotFound ?? false;

  let deleteTarget: ResolvedBrowserDeleteTarget;
  try {
    deleteTarget = await resolveBrowserDeleteTarget(
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

  try {
    await runtime.wikiBrowserDeletionService.deleteWikiNode(
      deleteTarget.browserDeleteInput,
    );
    if (deleteTarget.documentId) {
      runtime.invalidateDocumentState(deleteTarget.documentId);
    }
    if (deleteTarget.wikiToken) {
      runtime.documentInfoService.invalidateWiki(deleteTarget.wikiToken);
    }

    const postDeleteCheck = await verifyDeletedResource(
      runtime,
      deleteTarget.verifyTarget,
    );

    return {
      sourceType,
      sourceDocumentId,
      deletedDocumentId: deleteTarget.documentId ?? sourceDocumentId,
      deleted: true,
      notFound: false,
      deletionMode: 'browser_delete',
      note: buildDeleteVerificationNote(postDeleteCheck),
      postDeleteCheck,
    };
  } catch (error) {
    if (ignoreNotFound && isNotFoundError(error)) {
      return {
        sourceType,
        sourceDocumentId,
        deletedDocumentId: deleteTarget.documentId ?? sourceDocumentId,
        deleted: false,
        notFound: true,
      };
    }
    throw error;
  }
}

interface BrowserDeleteInput {
  nodeToken?: string;
  documentId?: string;
  spaceId?: string;
  title?: string;
}

interface ResolvedBrowserDeleteTarget {
  documentId?: string;
  wikiToken?: string;
  browserDeleteInput: BrowserDeleteInput;
  verifyTarget: {
    documentId: string;
    documentType: 'document' | 'wiki';
  };
}

async function verifyDeletedResource(
  runtime: DocumentEditRuntime,
  target: {
    documentId: string;
    documentType: 'document' | 'wiki';
  },
): Promise<NonNullable<DeleteDocumentResult['postDeleteCheck']>> {
  try {
    await runtime.documentInfoService.getDocumentInfo(target.documentId, target.documentType);
    return {
      attempted: true,
      authType: runtime.config.authType,
      verifiedDeleted: false,
      notFound: false,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        attempted: true,
        authType: runtime.config.authType,
        verifiedDeleted: true,
        notFound: true,
      };
    }
    return {
      attempted: true,
      authType: runtime.config.authType,
      verifiedDeleted: false,
      notFound: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveBrowserDeleteTarget(
  runtime: DocumentEditRuntime,
  sourceDocumentId: string,
  sourceType: 'document' | 'wiki',
): Promise<ResolvedBrowserDeleteTarget> {
  if (sourceType === 'wiki') {
    const wikiInfo = await runtime.documentInfoService.getDocumentInfo(
      sourceDocumentId,
      'wiki',
    );
    const nodeToken =
      pickString(wikiInfo, ['node_token', 'wiki_token']) ??
      extractWikiToken(sourceDocumentId) ??
      undefined;
    const documentId =
      pickString(wikiInfo, ['documentId', 'obj_token']) ??
      extractDocumentId(sourceDocumentId) ??
      undefined;
    const spaceId = pickString(wikiInfo, ['space_id']);
    const title = pickString(wikiInfo, ['title']);

    if (!nodeToken && !documentId) {
      throw new Error('Cannot resolve browser delete target from wiki input.');
    }

    return {
      documentId,
      wikiToken: nodeToken,
      browserDeleteInput: {
        nodeToken,
        documentId,
        spaceId,
        title,
      },
      verifyTarget: nodeToken
        ? { documentId: nodeToken, documentType: 'wiki' }
        : { documentId: documentId!, documentType: 'document' },
    };
  }

  const normalizedDocumentId = extractDocumentId(sourceDocumentId);
  if (!normalizedDocumentId) {
    throw new Error('Invalid document ID or document URL.');
  }

  const wikiInfo = await tryResolveWikiInfo(runtime, sourceDocumentId);
  if (wikiInfo) {
    const nodeToken =
      pickString(wikiInfo, ['node_token', 'wiki_token']) ??
      extractWikiToken(sourceDocumentId) ??
      undefined;
    const documentId =
      pickString(wikiInfo, ['documentId', 'obj_token']) ?? normalizedDocumentId;
    const spaceId = pickString(wikiInfo, ['space_id']);
    const title = pickString(wikiInfo, ['title']);
    return {
      documentId,
      wikiToken: nodeToken,
      browserDeleteInput: {
        nodeToken,
        documentId,
        spaceId,
        title,
      },
      verifyTarget: nodeToken
        ? { documentId: nodeToken, documentType: 'wiki' }
        : { documentId, documentType: 'document' },
    };
  }

  return {
    documentId: normalizedDocumentId,
    browserDeleteInput: {
      documentId: normalizedDocumentId,
    },
    verifyTarget: {
      documentId: normalizedDocumentId,
      documentType: 'document',
    },
  };
}

async function resolveDocumentId(
  runtime: DocumentEditRuntime,
  inputId: string,
  sourceType: 'document' | 'wiki',
): Promise<string> {
  if (sourceType === 'document') {
    const normalized = extractDocumentId(inputId);
    if (normalized) {
      return normalized;
    }

    const fromWikiNode = await tryResolveDocumentIdFromWikiNode(runtime, inputId);
    if (fromWikiNode) {
      return fromWikiNode;
    }

    throw new Error('Invalid document ID or document URL.');
  }

  const fromWikiNode = await tryResolveDocumentIdFromWikiNode(runtime, inputId);
  if (!fromWikiNode) {
    throw new Error('Cannot resolve document ID from wiki node.');
  }
  return fromWikiNode;
}

export async function resolveDocumentIdForDelete(
  runtime: DocumentEditRuntime,
  inputId: string,
  sourceType: 'document' | 'wiki',
): Promise<string> {
  return resolveDocumentId(runtime, inputId, sourceType);
}

async function tryResolveDocumentIdFromWikiNode(
  runtime: DocumentEditRuntime,
  wikiTokenOrUrl: string,
): Promise<string | null> {
  try {
    const info = await runtime.documentInfoService.getDocumentInfo(wikiTokenOrUrl, 'wiki');
    const fromInfo =
      typeof info.documentId === 'string'
        ? info.documentId
        : typeof info.obj_token === 'string'
          ? info.obj_token
          : '';
    const normalized = extractDocumentId(fromInfo) ?? fromInfo;
    return normalized || null;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function tryResolveWikiInfo(
  runtime: DocumentEditRuntime,
  inputId: string,
): Promise<Record<string, unknown> | null> {
  const looksLikeWiki = inputId.includes('/wiki/') || extractWikiToken(inputId) !== null;
  if (!looksLikeWiki) {
    return null;
  }
  try {
    return await runtime.documentInfoService.getDocumentInfo(inputId, 'wiki');
  } catch (error) {
    if (isNotFoundError(error) || isInvalidWikiInput(error)) {
      return null;
    }
    throw error;
  }
}

function isInvalidWikiInput(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes('invalid wiki token');
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function buildDeleteVerificationNote(
  postDeleteCheck: NonNullable<DeleteDocumentResult['postDeleteCheck']>,
): string | undefined {
  if (postDeleteCheck.verifiedDeleted) {
    return undefined;
  }
  if (postDeleteCheck.error) {
    return `Delete request completed, but verification failed: ${postDeleteCheck.error}`;
  }
  return 'Delete request completed, but immediate verification did not observe a not-found response yet.';
}

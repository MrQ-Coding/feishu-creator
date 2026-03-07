import type { DocumentEditRuntime } from './context.js';
import { normalizeRevisionId } from './helpers.js';
import { deleteChildrenRange } from './blockMutations.js';
import { resolveHeadingTarget } from './headingLocator.js';
import type {
  DeleteByHeadingInput,
  DeleteByHeadingResult,
} from './types.js';

export async function deleteByHeadingCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: DeleteByHeadingInput,
): Promise<DeleteByHeadingResult> {
  const target = await resolveHeadingTarget(runtime, normalizedDocumentId, input);
  const range = target.locateResult.range;
  const includeHeading = Boolean(input.includeHeading);
  const startIndex = includeHeading ? Math.max(0, range.startIndex - 1) : range.startIndex;
  const endIndex = range.endIndex;
  const deletedCount = Math.max(0, endIndex - startIndex);

  if (deletedCount > 0) {
    await deleteChildrenRange(
      runtime,
      normalizedDocumentId,
      target.parentBlockId,
      startIndex,
      endIndex,
      normalizeRevisionId(input.documentRevisionId),
    );
  }

  return {
    documentId: normalizedDocumentId,
    parentBlockId: target.parentBlockId,
    sectionHeading: range.headingText,
    sectionOccurrence: target.sectionOccurrence,
    includeHeading,
    startIndex,
    endIndex,
    deletedCount,
    scannedChildrenCount: target.locateResult.scannedChildrenCount,
    scannedAllChildren: target.locateResult.scannedAllChildren,
  };
}

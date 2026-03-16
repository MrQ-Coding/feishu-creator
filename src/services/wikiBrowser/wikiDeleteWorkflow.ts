import type { Page } from "playwright";
import type { AppConfig } from "../../config.js";
import { Logger } from "../../logger.js";
import {
  buildDocumentUrl,
  buildWikiUrl,
  describeDeleteTarget,
  formatResponsePreview,
} from "./helpers.js";
import { navigateToWikiPage } from "./pageActions.js";
import { requestSpaceApi } from "./spaceApiClient.js";
import type {
  CurrentWikiContext,
  DeleteWikiNodeInput,
  InternalDeleteNodeData,
  InternalWikiNodeData,
  ReusableBrowserSession,
  WikiDeleteContext,
} from "./types.js";
import {
  INTERNAL_API_SUCCESS_CODE,
  INTERNAL_DELETE_SOURCE_NOT_EXIST_CODE,
  INTERNAL_GET_NODE_NOT_FOUND_CODE,
} from "./types.js";

export async function deleteViaInternalApi(
  session: ReusableBrowserSession,
  input: DeleteWikiNodeInput,
  config: AppConfig["feishu"],
): Promise<void> {
  const context = await resolveDeleteContext(session.page, input, config);
  const existingNode = await getInternalWikiNode(
    session,
    config,
    context.spaceId,
    context.nodeToken,
  );
  if (existingNode.status === "missing") {
    Logger.info(
      `Wiki node already missing before direct delete: ${describeDeleteTarget(config, input)}.`,
    );
    return;
  }
  if (existingNode.status === "failed") {
    throw new Error(
      `Cannot query wiki node ${describeDeleteTarget(config, input)} before delete: ${existingNode.message}`,
    );
  }

  const effectiveTitle = input.title ?? existingNode.data.title ?? context.title;
  const deleteResponse = await requestSpaceApi<InternalDeleteNodeData>(
    session,
    {
      method: "POST",
      path: "/space/api/wiki/v2/tree/del_single_node/",
      body: {
        space_id: context.spaceId,
        wiki_token: context.nodeToken,
      },
    },
    config,
  );

  if (deleteResponse.status !== 200 || !deleteResponse.json) {
    throw new Error(
      `Wiki delete API returned HTTP ${deleteResponse.status} for ${effectiveTitle ?? context.nodeToken}. Response: ${formatResponsePreview(deleteResponse.text)}`,
    );
  }

  const deleteCode = deleteResponse.json.code ?? -1;
  if (deleteCode === INTERNAL_DELETE_SOURCE_NOT_EXIST_CODE) {
    Logger.info(
      `Wiki node already missing while deleting through direct API: ${effectiveTitle ?? context.nodeToken}.`,
    );
    return;
  }
  if (deleteCode !== INTERNAL_API_SUCCESS_CODE) {
    throw new Error(
      `Wiki delete API returned code ${deleteCode} for ${effectiveTitle ?? context.nodeToken}: ${deleteResponse.json.msg ?? formatResponsePreview(deleteResponse.text)}`,
    );
  }
  if (deleteResponse.json.data?.need_apply) {
    throw new Error(
      `Wiki delete API requires approval for ${effectiveTitle ?? context.nodeToken}.`,
    );
  }

  await waitForInternalDeleteCompletion(
    session,
    config,
    {
      ...context,
      title: effectiveTitle,
    },
    deleteResponse.json.data?.task_id,
  );
}

export async function resolveDeleteContext(
  page: Page,
  input: DeleteWikiNodeInput,
  config: AppConfig["feishu"],
): Promise<WikiDeleteContext> {
  const explicitSpaceId = input.spaceId?.trim();
  const explicitNodeToken = input.nodeToken?.trim();
  const explicitDocumentId = input.documentId?.trim();
  if (!explicitNodeToken && !explicitDocumentId) {
    throw new Error("nodeToken or documentId is required for wiki deletion.");
  }

  if (explicitSpaceId && explicitNodeToken) {
    return {
      nodeToken: explicitNodeToken,
      spaceId: explicitSpaceId,
      title: input.title,
    };
  }

  const currentContext = await waitForCurrentWikiContext(
    page,
    {
      documentId: explicitDocumentId,
      nodeToken: explicitNodeToken,
    },
    Math.min(config.playwrightActionTimeoutMs, 1500),
  );
  if (
    currentContext?.spaceId &&
    ((explicitNodeToken && currentContext.nodeToken === explicitNodeToken) ||
      (explicitDocumentId &&
        currentContext.documentId === explicitDocumentId &&
        currentContext.nodeToken))
  ) {
    return {
      nodeToken: currentContext.nodeToken!,
      spaceId: currentContext.spaceId,
      title: input.title ?? currentContext.title,
    };
  }

  const candidateUrls = explicitNodeToken
    ? [buildWikiUrl(config, explicitNodeToken)]
    : [buildDocumentUrl(config, explicitDocumentId!)];
  for (const targetUrl of candidateUrls) {
    await navigateToWikiPage(page, targetUrl, config.playwrightActionTimeoutMs);
    const resolvedContext = await waitForCurrentWikiContext(
      page,
      {
        documentId: explicitDocumentId,
        nodeToken: explicitNodeToken,
      },
      Math.min(config.playwrightActionTimeoutMs, 5000),
    );
    if (
      resolvedContext?.spaceId &&
      resolvedContext.nodeToken &&
      (!explicitNodeToken || resolvedContext.nodeToken === explicitNodeToken)
    ) {
      return {
        nodeToken: resolvedContext.nodeToken,
        spaceId: resolvedContext.spaceId,
        title: input.title ?? resolvedContext.title,
      };
    }
  }

  throw new Error(
    `Cannot resolve wiki node/space_id for ${describeDeleteTarget(config, input)}.`,
  );
}

export async function readCurrentWikiContext(
  page: Page,
): Promise<CurrentWikiContext | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(() => {
        const current = (
          window as typeof window & {
            current_space_wiki?: {
              space_id?: string;
              wiki_token?: string;
              obj_token?: string;
              title?: string;
            };
          }
        ).current_space_wiki;
        if (!current) {
          return null;
        }
        return {
          spaceId: current.space_id,
          nodeToken: current.wiki_token,
          documentId: current.obj_token,
          title: current.title,
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isRetryableContextReadError(message) || attempt >= 2) {
        throw error;
      }
      await page.waitForLoadState("domcontentloaded", {
        timeout: 1500,
      }).catch(() => undefined);
      await page.waitForTimeout(150);
    }
  }

  return null;
}

async function waitForCurrentWikiContext(
  page: Page,
  matcher: {
    documentId?: string;
    nodeToken?: string;
  },
  timeoutMs: number,
): Promise<CurrentWikiContext | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const currentContext = await readCurrentWikiContext(page);
    if (
      currentContext?.spaceId &&
      currentContext.nodeToken &&
      (!matcher.nodeToken || currentContext.nodeToken === matcher.nodeToken) &&
      (!matcher.documentId || currentContext.documentId === matcher.documentId)
    ) {
      return currentContext;
    }
    await page.waitForTimeout(200);
  }

  return null;
}

function isRetryableContextReadError(message: string): boolean {
  return (
    message.includes("Execution context was destroyed") ||
    message.includes("Cannot find context with specified id") ||
    message.includes("Failed to find execution context")
  );
}

export async function getInternalWikiNode(
  session: ReusableBrowserSession,
  config: AppConfig["feishu"],
  spaceId: string,
  nodeToken: string,
): Promise<
  | { status: "found"; data: InternalWikiNodeData }
  | { status: "missing"; code?: number; message: string }
  | { status: "failed"; code?: number; message: string }
> {
  const response = await requestSpaceApi<InternalWikiNodeData>(
    session,
    {
      method: "GET",
      path: buildGetNodePath(spaceId, nodeToken),
    },
    config,
  );

  if (response.status !== 200 || !response.json) {
    return {
      status: "failed",
      message: `HTTP ${response.status}: ${formatResponsePreview(response.text)}`,
    };
  }

  const code = response.json.code ?? -1;
  if (code === INTERNAL_API_SUCCESS_CODE && response.json.data) {
    return {
      status: "found",
      data: response.json.data,
    };
  }
  if (code === INTERNAL_GET_NODE_NOT_FOUND_CODE) {
    return {
      status: "missing",
      code,
      message: response.json.msg ?? "Wiki node not found.",
    };
  }
  return {
    status: "failed",
    code,
    message: response.json.msg ?? formatResponsePreview(response.text),
  };
}

export async function waitForInternalDeleteCompletion(
  session: ReusableBrowserSession,
  config: AppConfig["feishu"],
  context: WikiDeleteContext,
  taskId?: string,
): Promise<void> {
  const deadline = Date.now() + config.playwrightActionTimeoutMs;

  while (Date.now() <= deadline) {
    const probe = await getInternalWikiNode(
      session,
      config,
      context.spaceId,
      context.nodeToken,
    );
    if (probe.status === "missing") {
      return;
    }
    if (probe.status === "failed") {
      throw new Error(
        `Wiki delete verification failed for ${context.title ?? context.nodeToken}: ${probe.message}`,
      );
    }
    await delay(500);
  }

  let statusMessage = "";
  if (taskId && taskId !== "0") {
    const statusResponse = await requestSpaceApi<Record<string, unknown>>(
      session,
      {
        method: "GET",
        path: `/space/api/wiki/v2/tree/del_single_node_status/?task_id=${encodeURIComponent(taskId)}`,
      },
      config,
    );
    if (statusResponse.json) {
      statusMessage = ` Delete task status: code=${statusResponse.json.code ?? "unknown"}, msg=${statusResponse.json.msg ?? "unknown"}.`;
    }
  }

  throw new Error(
    `Wiki delete did not complete within ${config.playwrightActionTimeoutMs}ms for ${context.title ?? context.nodeToken}.${statusMessage}`,
  );
}

function buildGetNodePath(spaceId: string, nodeToken: string): string {
  const params = new URLSearchParams({
    wiki_token: nodeToken,
    space_id: spaceId,
    expand_shortcut: "true",
    with_deleted: "true",
  });
  return `/space/api/wiki/v2/tree/get_node/?${params.toString()}`;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

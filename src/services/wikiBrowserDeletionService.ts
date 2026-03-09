import { execFile as execFileCallback } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import { Logger } from "../logger.js";
import {
  bootstrapAutomationProfile,
  createTemporaryAutomationProfileDir,
  promoteAutomationProfile,
  resolveSystemBrowserProfileSeedSource,
  type PlaywrightBrowserFamily,
} from "./playwrightProfileBootstrap.js";

const execFile = promisify(execFileCallback);

type BrowserFamily = PlaywrightBrowserFamily;
type PlaywrightModule = typeof import("playwright");

interface DeleteWikiNodeInput {
  nodeToken?: string;
  documentId?: string;
  spaceId?: string;
  title?: string;
}

interface WikiDeleteContext {
  nodeToken: string;
  spaceId: string;
  title?: string;
}

interface BrowserLaunchTarget {
  family: BrowserFamily;
  executablePath?: string;
  source: string;
}

interface ReusableBrowserSession {
  context: BrowserContext;
  page: Page;
  headless: boolean;
  launchSignature: string;
}

interface LoginRecoveryProfile {
  cleanup: () => Promise<void>;
  persist: () => Promise<void>;
  sourceLabel: string;
  userDataDir: string;
}

interface SpaceApiEnvelope<TData> {
  code?: number;
  msg?: string;
  data?: TData | null;
}

interface SpaceApiRequest {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}

interface SpaceApiResponse<TData> {
  status: number;
  text: string;
  json: SpaceApiEnvelope<TData> | null;
  csrfToken?: string;
}

interface InternalWikiNodeData {
  space_id?: string;
  wiki_token?: string;
  title?: string;
  obj_token?: string;
}

interface InternalDeleteNodeData {
  task_id?: string;
  need_apply?: boolean;
  reviewer?: unknown;
  users?: unknown;
}

interface CurrentWikiContext {
  spaceId?: string;
  nodeToken?: string;
  documentId?: string;
  title?: string;
}

const INTERNAL_API_SUCCESS_CODE = 0;
const INTERNAL_DELETE_SOURCE_NOT_EXIST_CODE = 920004002;
const INTERNAL_GET_NODE_NOT_FOUND_CODE = 920004123;

class LoginRequiredError extends Error {
  constructor(
    message: string,
    readonly screenshotPath: string,
  ) {
    super(message);
    this.name = "LoginRequiredError";
  }
}

export class WikiBrowserDeletionService {
  private playwrightModulePromise?: Promise<PlaywrightModule>;
  private launchTargetPromise?: Promise<BrowserLaunchTarget>;
  private reusableSession?: ReusableBrowserSession;
  private operationChain: Promise<void> = Promise.resolve();
  private cleanupHooksRegistered = false;

  constructor(private readonly config: AppConfig["feishu"]) {
    this.registerProcessCleanupHooks();
  }

  async deleteWikiNode(input: DeleteWikiNodeInput): Promise<void> {
    await this.deleteWikiNodes([input]);
  }

  async shutdown(): Promise<void> {
    await this.closeReusableSession();
  }

  async deleteWikiNodes(inputs: DeleteWikiNodeInput[]): Promise<void> {
    const normalizedInputs = inputs.filter(
      (item) =>
        (item.nodeToken?.trim().length ?? 0) > 0 ||
        (item.documentId?.trim().length ?? 0) > 0,
    );
    if (normalizedInputs.length <= 0) {
      return;
    }

    await this.withOperationLock(async () => {
      const playwright = await this.loadPlaywrightModule();
      await mkdir(this.config.playwrightUserDataDir, { recursive: true });
      const launchTarget = await this.getLaunchTarget();
      Logger.info(
        `Playwright wiki deletion browser target: family=${launchTarget.family}, source=${launchTarget.source}, executable=${launchTarget.executablePath ?? "<playwright-bundled>"}`,
      );

      try {
        for (const input of normalizedInputs) {
          await this.deleteWikiNodeWithRecovery(
            playwright,
            launchTarget,
            input,
          );
        }
      } finally {
        // Always release the persistent profile lock after each top-level delete call.
        await this.closeReusableSession();
      }
    });
  }

  private buildWikiUrl(nodeToken: string): string {
    return `${this.config.uiBaseUrl.replace(/\/+$/, "")}/wiki/${nodeToken}`;
  }

  private buildDocumentUrl(documentId: string): string {
    return `${this.config.uiBaseUrl.replace(/\/+$/, "")}/docx/${documentId}`;
  }

  private buildWikiHomeUrl(): string {
    return `${this.config.uiBaseUrl.replace(/\/+$/, "")}/wiki/`;
  }

  private async resolveLaunchTarget(): Promise<BrowserLaunchTarget> {
    const explicitPath = this.config.playwrightExecutablePath?.trim();
    if (explicitPath) {
      return {
        family: this.inferBrowserFamilyFromExecutable(explicitPath),
        executablePath: explicitPath,
        source: "env:FEISHU_PLAYWRIGHT_EXECUTABLE_PATH",
      };
    }

    const systemCandidate = await this.resolveSystemBrowserCandidate();
    if (systemCandidate) {
      return systemCandidate;
    }

    return {
      family: "chromium",
      source: "playwright-bundled-fallback",
    };
  }

  private async getLaunchTarget(): Promise<BrowserLaunchTarget> {
    this.launchTargetPromise ??= this.resolveLaunchTarget();
    return this.launchTargetPromise;
  }

  private async loadPlaywrightModule(): Promise<PlaywrightModule> {
    this.playwrightModulePromise ??= import("playwright") as Promise<PlaywrightModule>;
    return this.playwrightModulePromise;
  }

  private async deleteWikiNodeWithRecovery(
    playwright: PlaywrightModule,
    launchTarget: BrowserLaunchTarget,
    input: DeleteWikiNodeInput,
  ): Promise<void> {
    const targetLabel = this.describeDeleteTarget(input);
    const effectiveHeadless = this.resolveEffectiveHeadlessMode();
    if (this.shouldAttemptInteractiveLoginFirst(effectiveHeadless)) {
      await this.ensureInteractiveLoginReady(playwright, launchTarget, input);
    }
    try {
      await this.runDeleteAttempt(
        playwright,
        launchTarget,
        input,
        effectiveHeadless,
      );
    } catch (error) {
      if (!(error instanceof LoginRequiredError) || !effectiveHeadless) {
        throw error;
      }
      if (!this.canRunHeadedBrowser()) {
        throw new Error(
          `Headless wiki deletion requires login for ${targetLabel}, but no GUI display is available for interactive recovery. Automatic lightweight profile bootstrap needs one visible login first. Prepare a logged-in browser profile under FEISHU_PLAYWRIGHT_USER_DATA_DIR and keep FEISHU_PLAYWRIGHT_HEADLESS=true. Screenshot: ${error.screenshotPath}`,
        );
      }

      Logger.info(
        `Headless wiki deletion requires login for ${targetLabel}. Preparing a lightweight browser profile for one-time manual login.`,
      );
      await this.recoverLoginInteractively(playwright, launchTarget, input);

      try {
        await this.runDeleteAttempt(playwright, launchTarget, input, true);
      } catch (retryError) {
        if (retryError instanceof LoginRequiredError) {
          throw new Error(
            `Feishu login recovery completed, but the headless session is still unavailable for ${targetLabel}. Screenshot: ${retryError.screenshotPath}`,
          );
        }
        throw retryError;
      }
    }
  }

  private resolveEffectiveHeadlessMode(): boolean {
    if (this.config.playwrightHeadless) {
      return true;
    }
    if (this.canRunHeadedBrowser()) {
      return false;
    }
    Logger.warn(
      "FEISHU_PLAYWRIGHT_HEADLESS=false but no GUI display is available. Falling back to headless mode.",
    );
    return true;
  }

  private canRunHeadedBrowser(): boolean {
    if (process.platform !== "linux") {
      return true;
    }
    return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  }

  private shouldAttemptInteractiveLoginFirst(headless: boolean): boolean {
    return (
      headless &&
      this.config.playwrightLoginRecoveryMode === "interactive_first" &&
      this.canRunHeadedBrowser()
    );
  }

  private async ensureInteractiveLoginReady(
    playwright: PlaywrightModule,
    launchTarget: BrowserLaunchTarget,
    input: DeleteWikiNodeInput,
  ): Promise<void> {
    const targetLabel = this.describeDeleteTarget(input);
    const session = await this.getOrCreateSession(playwright, launchTarget, true);
    if (await this.hasActiveWebSession(session)) {
      return;
    }

    Logger.info(
      `No active Feishu web session for ${targetLabel}. Opening a visible browser for manual login before deletion.`,
    );
    await this.recoverLoginInteractively(playwright, launchTarget, input);
  }

  private async ensureLoggedIn(
    page: Page,
    wikiUrl: string,
    title?: string,
    headless = this.config.playwrightHeadless,
  ): Promise<void> {
    if (!this.isLoginPage(page.url())) {
      return;
    }

    if (headless) {
      const screenshotPath = await this.captureLoginScreenshot(page);
      throw new LoginRequiredError(
        `Playwright wiki deletion requires an existing Feishu web session. Login is required for ${title ?? wikiUrl}. The service will try to recover by opening a visible browser with FEISHU_PLAYWRIGHT_USER_DATA_DIR=${this.config.playwrightUserDataDir}. Screenshot: ${screenshotPath}`,
        screenshotPath,
      );
    }

    Logger.info(
      `Playwright wiki deletion requires login for ${title ?? wikiUrl}. Waiting up to ${this.config.playwrightLoginTimeoutMs}ms for manual login in the opened browser. The window will close automatically after login and the service will continue.`,
    );

    await page.waitForFunction(
      () =>
        !location.href.includes("/accounts/page/login") &&
        !location.hostname.startsWith("accounts."),
      undefined,
      { timeout: this.config.playwrightLoginTimeoutMs },
    );
    await this.navigateToWikiPage(page, wikiUrl);

    if (this.isLoginPage(page.url())) {
      throw new Error(`Feishu login did not complete for ${title ?? wikiUrl}.`);
    }
  }

  private async runDeleteAttempt(
    playwright: PlaywrightModule,
    launchTarget: BrowserLaunchTarget,
    input: DeleteWikiNodeInput,
    headless: boolean,
  ): Promise<void> {
    const session = await this.getOrCreateSession(playwright, launchTarget, headless);
    const targetLabel = this.describeDeleteTarget(input);
    try {
      session.page.setDefaultTimeout(this.config.playwrightActionTimeoutMs);
      await this.ensureAuthenticatedSession(session, targetLabel, headless);

      try {
        await this.deleteViaInternalApi(session, input);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        Logger.warn(
          `Internal wiki delete API failed for ${targetLabel}: ${message}. Falling back to UI automation.`,
        );
      }

      const fallbackContext = input.nodeToken?.trim()
        ? { nodeToken: input.nodeToken.trim(), title: input.title }
        : await this.resolveDeleteContext(session.page, input);
      const wikiUrl = this.buildWikiUrl(fallbackContext.nodeToken);
      await this.navigateToWikiPage(session.page, wikiUrl);
      await this.ensureLoggedIn(session.page, wikiUrl, targetLabel, headless);
      await this.deleteFromWikiPage(
        session.page,
        wikiUrl,
        input.title ?? fallbackContext.title,
      );
    } catch (error) {
      await this.resetReusableSessionIfMatches(session);
      throw error;
    }
  }

  private async prepareLoginRecoveryProfile(
    launchTarget: BrowserLaunchTarget,
  ): Promise<LoginRecoveryProfile> {
    const targetDir = path.resolve(this.config.playwrightUserDataDir);
    const recoveryDir = await createTemporaryAutomationProfileDir(targetDir);
    const seedSource = await resolveSystemBrowserProfileSeedSource(
      launchTarget.family,
      launchTarget.executablePath,
    );

    try {
      const result = await bootstrapAutomationProfile({
        browserFamily: launchTarget.family,
        clean: true,
        continueOnError: true,
        sourceDir: seedSource?.dir,
        targetDir: recoveryDir,
      });

      if (result.mode === "seeded") {
        Logger.info(
          `Prepared lightweight Playwright profile at ${recoveryDir} from ${seedSource?.label ?? result.sourceLabel}. Copied ${result.copiedEntries.length} entries.`,
        );
        if (result.skippedEntries.length > 0) {
          Logger.warn(
            `Skipped ${result.skippedEntries.length} profile entries while preparing ${recoveryDir}: ${result.skippedEntries.join("; ")}`,
          );
        }
      } else {
        Logger.info(
          `Prepared empty Playwright profile at ${recoveryDir}. No reusable browser seed profile was found.`,
        );
      }
    } catch (error) {
      await rm(recoveryDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    let persisted = false;
    return {
      userDataDir: recoveryDir,
      sourceLabel: seedSource?.label ?? "empty profile",
      persist: async () => {
        await promoteAutomationProfile(recoveryDir, targetDir);
        persisted = true;
        Logger.info(
          `Saved Playwright login session to ${targetDir}. Future wiki deletions will reuse this lightweight profile.`,
        );
      },
      cleanup: async () => {
        if (persisted) {
          return;
        }
        await rm(recoveryDir, { recursive: true, force: true });
      },
    };
  }

  private async recoverLoginInteractively(
    playwright: PlaywrightModule,
    launchTarget: BrowserLaunchTarget,
    input: DeleteWikiNodeInput,
  ): Promise<void> {
    await this.closeReusableSession();
    const recoveryProfile = await this.prepareLoginRecoveryProfile(launchTarget);
    try {
      await this.performInteractiveLogin(
        playwright,
        launchTarget,
        input,
        recoveryProfile.userDataDir,
      );
      await recoveryProfile.persist();
    } catch (error) {
      await recoveryProfile.cleanup().catch(() => undefined);
      throw error;
    }
  }

  private async performInteractiveLogin(
    playwright: PlaywrightModule,
    launchTarget: BrowserLaunchTarget,
    input: DeleteWikiNodeInput,
    userDataDir = this.config.playwrightUserDataDir,
  ): Promise<void> {
    const context = await this.launchContext(
      playwright,
      launchTarget,
      false,
      userDataDir,
    );
    const sessionUrl = this.buildWikiHomeUrl();
    const targetLabel = this.describeDeleteTarget(input);
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      page.setDefaultTimeout(this.config.playwrightActionTimeoutMs);
      await this.navigateToWikiPage(page, sessionUrl);
      await this.ensureLoggedIn(page, sessionUrl, targetLabel, false);
      Logger.info(
        `Manual Feishu login completed for ${targetLabel}. Closing the browser and retrying headless deletion.`,
      );
    } finally {
      await context.close();
    }
  }

  private async launchContext(
    playwright: PlaywrightModule,
    launchTarget: BrowserLaunchTarget,
    headless: boolean,
    userDataDir = this.config.playwrightUserDataDir,
  ): Promise<BrowserContext> {
    return playwright[launchTarget.family].launchPersistentContext(
      userDataDir,
      {
        headless,
        viewport: { width: 1440, height: 960 },
        executablePath: launchTarget.executablePath,
      },
    );
  }

  private async getOrCreateSession(
    playwright: PlaywrightModule,
    launchTarget: BrowserLaunchTarget,
    headless: boolean,
    userDataDir = this.config.playwrightUserDataDir,
  ): Promise<ReusableBrowserSession> {
    const launchSignature = this.buildLaunchSignature(
      launchTarget,
      headless,
      userDataDir,
    );
    if (
      this.reusableSession &&
      this.reusableSession.launchSignature === launchSignature &&
      !this.reusableSession.page.isClosed()
    ) {
      return this.reusableSession;
    }

    await this.closeReusableSession();
    const context = await this.launchContext(
      playwright,
      launchTarget,
      headless,
      userDataDir,
    );
    const page = context.pages()[0] ?? (await context.newPage());
    const session: ReusableBrowserSession = {
      context,
      page,
      headless,
      launchSignature,
    };
    this.reusableSession = session;
    return session;
  }

  private buildLaunchSignature(
    launchTarget: BrowserLaunchTarget,
    headless: boolean,
    userDataDir: string,
  ): string {
    return [
      launchTarget.family,
      launchTarget.executablePath ?? "<playwright-bundled>",
      path.resolve(userDataDir),
      headless ? "headless" : "headed",
    ].join(":");
  }

  private async resetReusableSessionIfMatches(
    session: ReusableBrowserSession,
  ): Promise<void> {
    if (this.reusableSession !== session) {
      return;
    }
    await this.closeReusableSession();
  }

  private async closeReusableSession(): Promise<void> {
    const session = this.reusableSession;
    this.reusableSession = undefined;
    if (!session) {
      return;
    }
    await session.context.close().catch(() => undefined);
  }

  private registerProcessCleanupHooks(): void {
    if (this.cleanupHooksRegistered) {
      return;
    }
    this.cleanupHooksRegistered = true;

    const close = () => {
      void this.closeReusableSession();
    };

    process.once("beforeExit", close);
    process.once("exit", close);
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, close);
    }
  }

  private async deleteFromWikiPage(
    page: Page,
    wikiUrl: string,
    title?: string,
  ): Promise<void> {
    if (title) {
      try {
        await this.openDeleteConfirmationFromSidebar(page, wikiUrl, title);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        Logger.warn(
          `Sidebar wiki deletion path failed for ${title}: ${message}. Falling back to the document menu.`,
        );
      }
    }

    if (!(await this.waitForDeleteConfirmButton(page, 2000))) {
      await this.openDeleteConfirmationFromTopMenu(page, wikiUrl);
    }
    await this.confirmDeletion(page);

    try {
      await page.waitForFunction(
        ([originalUrl, pageTitle]) => {
          if (location.href !== originalUrl) return true;
          if (!pageTitle) return false;
          return !document.body.innerText.includes(pageTitle);
        },
        [wikiUrl, title ?? ""],
        {
          timeout: this.config.playwrightActionTimeoutMs,
        },
      );
    } catch (error) {
      try {
        await page.waitForURL(/\/drive\/home\/?/, {
          timeout: this.config.playwrightActionTimeoutMs,
        });
        return;
      } catch {
        if (this.isDeletedLandingPage(page.url())) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Playwright delete confirmation did not finish for ${title ?? page.url()}: ${message}`,
        );
      }
    }
  }

  private async deleteViaInternalApi(
    session: ReusableBrowserSession,
    input: DeleteWikiNodeInput,
  ): Promise<void> {
    const context = await this.resolveDeleteContext(session.page, input);
    const existingNode = await this.getInternalWikiNode(
      session,
      context.spaceId,
      context.nodeToken,
    );
    if (existingNode.status === "missing") {
      Logger.info(
        `Wiki node already missing before direct delete: ${this.describeDeleteTarget(input)}.`,
      );
      return;
    }
    if (existingNode.status === "failed") {
      throw new Error(
        `Cannot query wiki node ${this.describeDeleteTarget(input)} before delete: ${existingNode.message}`,
      );
    }

    const effectiveTitle = input.title ?? existingNode.data.title ?? context.title;
    const deleteResponse = await this.requestSpaceApi<InternalDeleteNodeData>(session, {
      method: "POST",
      path: "/space/api/wiki/v2/tree/del_single_node/",
      body: {
        space_id: context.spaceId,
        wiki_token: context.nodeToken,
      },
    });

    if (deleteResponse.status !== 200 || !deleteResponse.json) {
      throw new Error(
        `Wiki delete API returned HTTP ${deleteResponse.status} for ${effectiveTitle ?? context.nodeToken}. Response: ${this.formatResponsePreview(deleteResponse.text)}`,
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
        `Wiki delete API returned code ${deleteCode} for ${effectiveTitle ?? context.nodeToken}: ${deleteResponse.json.msg ?? this.formatResponsePreview(deleteResponse.text)}`,
      );
    }
    if (deleteResponse.json.data?.need_apply) {
      throw new Error(
        `Wiki delete API requires approval for ${effectiveTitle ?? context.nodeToken}.`,
      );
    }

    await this.waitForInternalDeleteCompletion(session, {
      ...context,
      title: effectiveTitle,
    }, deleteResponse.json.data?.task_id);
  }

  private async resolveDeleteContext(
    page: Page,
    input: DeleteWikiNodeInput,
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

    const currentContext = await this.readCurrentWikiContext(page);
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
      ? [this.buildWikiUrl(explicitNodeToken)]
      : [
          this.buildDocumentUrl(explicitDocumentId!),
          this.buildWikiUrl(explicitDocumentId!),
        ];
    for (const targetUrl of candidateUrls) {
      await this.navigateToWikiPage(page, targetUrl);
      const resolvedContext = await this.readCurrentWikiContext(page);
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
      `Cannot resolve wiki node/space_id for ${this.describeDeleteTarget(input)}.`,
    );
  }

  private async readCurrentWikiContext(page: Page): Promise<CurrentWikiContext | null> {
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
  }

  private async getInternalWikiNode(
    session: ReusableBrowserSession,
    spaceId: string,
    nodeToken: string,
  ): Promise<
    | { status: "found"; data: InternalWikiNodeData }
    | { status: "missing"; code?: number; message: string }
    | { status: "failed"; code?: number; message: string }
  > {
    const response = await this.requestSpaceApi<InternalWikiNodeData>(session, {
      method: "GET",
      path: this.buildGetNodePath(spaceId, nodeToken),
    });

    if (response.status !== 200 || !response.json) {
      return {
        status: "failed",
        message: `HTTP ${response.status}: ${this.formatResponsePreview(response.text)}`,
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
      message: response.json.msg ?? this.formatResponsePreview(response.text),
    };
  }

  private async waitForInternalDeleteCompletion(
    session: ReusableBrowserSession,
    context: WikiDeleteContext,
    taskId?: string,
  ): Promise<void> {
    const deadline = Date.now() + this.config.playwrightActionTimeoutMs;

    while (Date.now() <= deadline) {
      const probe = await this.getInternalWikiNode(
        session,
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
      await this.delay(500);
    }

    let statusMessage = "";
    if (taskId && taskId !== "0") {
      const statusResponse = await this.requestSpaceApi<Record<string, unknown>>(session, {
        method: "GET",
        path: `/space/api/wiki/v2/tree/del_single_node_status/?task_id=${encodeURIComponent(taskId)}`,
      });
      if (statusResponse.json) {
        statusMessage = ` Delete task status: code=${statusResponse.json.code ?? "unknown"}, msg=${statusResponse.json.msg ?? "unknown"}.`;
      }
    }

    throw new Error(
      `Wiki delete did not complete within ${this.config.playwrightActionTimeoutMs}ms for ${context.title ?? context.nodeToken}.${statusMessage}`,
    );
  }

  private buildGetNodePath(spaceId: string, nodeToken: string): string {
    const params = new URLSearchParams({
      wiki_token: nodeToken,
      space_id: spaceId,
      expand_shortcut: "true",
      with_deleted: "true",
    });
    return `/space/api/wiki/v2/tree/get_node/?${params.toString()}`;
  }

  private async requestSpaceApi<TData>(
    session: ReusableBrowserSession,
    request: SpaceApiRequest,
  ): Promise<SpaceApiResponse<TData>> {
    const csrfToken = await this.readCsrfToken(session.context);
    const url = new URL(
      request.path,
      `${this.config.uiBaseUrl.replace(/\/+$/, "")}/`,
    ).toString();
    const headers: Record<string, string> = {};
    if (request.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (csrfToken) {
      headers["x-csrftoken"] = csrfToken;
    }
    headers.Origin = this.config.uiBaseUrl.replace(/\/+$/, "");
    headers.Referer = this.resolveRequestReferer(session.page.url());

    try {
      const response = await session.context.request.fetch(url, {
        method: request.method,
        headers,
        failOnStatusCode: false,
        data:
          request.body === undefined
            ? undefined
            : JSON.stringify(request.body),
      });
      const text = await response.text();
      let json: SpaceApiEnvelope<TData> | null = null;
      try {
        json = JSON.parse(text) as SpaceApiEnvelope<TData>;
      } catch {
        json = null;
      }

      return {
        status: response.status(),
        text,
        json,
        csrfToken,
      };
    } catch (error) {
      return {
        status: 0,
        text: error instanceof Error ? error.message : String(error),
        json: null,
        csrfToken,
      };
    }
  }

  private describeDeleteTarget(input: DeleteWikiNodeInput): string {
    if (input.title) {
      return input.title;
    }
    const nodeToken = input.nodeToken?.trim();
    if (nodeToken) {
      return this.buildWikiUrl(nodeToken);
    }
    const documentId = input.documentId?.trim();
    if (documentId) {
      return this.buildDocumentUrl(documentId);
    }
    return "unknown target";
  }

  private formatResponsePreview(text: string): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
  }

  private resolveRequestReferer(currentPageUrl: string): string {
    const uiBaseUrl = this.config.uiBaseUrl.replace(/\/+$/, "");
    if (currentPageUrl && currentPageUrl.startsWith(uiBaseUrl)) {
      return currentPageUrl;
    }
    return this.buildWikiHomeUrl();
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async ensureAuthenticatedSession(
    session: ReusableBrowserSession,
    targetLabel: string,
    headless: boolean,
  ): Promise<void> {
    if (await this.hasActiveWebSession(session)) {
      return;
    }

    const sessionUrl = this.buildWikiHomeUrl();
    await this.navigateToWikiPage(session.page, sessionUrl);
    await this.ensureLoggedIn(session.page, sessionUrl, targetLabel, headless);

    if (!(await this.hasActiveWebSession(session))) {
      throw new Error(`Feishu web session is unavailable for ${targetLabel}.`);
    }
  }

  private async hasActiveWebSession(
    session: ReusableBrowserSession,
  ): Promise<boolean> {
    const response = await this.requestSpaceApi<Record<string, unknown>>(session, {
      method: "GET",
      path: "/space/api/user/",
    });
    return response.status === 200 && response.json?.code === INTERNAL_API_SUCCESS_CODE;
  }

  private async readCsrfToken(context: BrowserContext): Promise<string | undefined> {
    const cookies = await context.cookies(this.config.uiBaseUrl);
    return cookies.find((cookie) => cookie.name === "_csrf_token")?.value;
  }

  private async openDeleteConfirmationFromTopMenu(
    page: Page,
    wikiUrl: string,
  ): Promise<void> {
    const moreButton = page.locator('button[data-e2e="suite-more-btn"]');
    await moreButton.waitFor({
      state: "visible",
      timeout: this.config.playwrightActionTimeoutMs,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await moreButton.click();
        const deleteItem = this.getDeleteMenuItem(page);
        await deleteItem.waitFor({
          state: "visible",
          timeout: Math.min(this.config.playwrightActionTimeoutMs, 4000),
        });
        await deleteItem.click();

        if (await this.waitForDeleteConfirmButton(page, 4000)) {
          return;
        }
      } catch {
        // Retry after a clean page reload below.
      }

      await page.keyboard.press("Escape").catch(() => undefined);
      if (attempt < 2) {
        await this.navigateToWikiPage(page, wikiUrl);
        await moreButton.waitFor({
          state: "visible",
          timeout: this.config.playwrightActionTimeoutMs,
        });
      }
    }

    throw new Error(
      `Failed to open delete confirmation from the document menu for ${page.url()}.`,
    );
  }

  private async openDeleteConfirmationFromSidebar(
    page: Page,
    wikiUrl: string,
    title: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const node = await this.findSidebarNode(page, title);
        await node.scrollIntoViewIfNeeded();
        await node.hover();

        let moreButton = node.locator(".more-operate-btn").last();
        if ((await moreButton.count()) <= 0) {
          moreButton = page.locator(".workspace-tree-view-node--hovered .more-operate-btn").last();
        }

        await moreButton.waitFor({
          state: "visible",
          timeout: Math.min(this.config.playwrightActionTimeoutMs, 3000),
        });
        await moreButton.click();

        const deleteItem = this.getDeleteMenuItem(page);
        await deleteItem.waitFor({
          state: "visible",
          timeout: Math.min(this.config.playwrightActionTimeoutMs, 4000),
        });
        await deleteItem.click();

        if (await this.waitForDeleteConfirmButton(page, 4000)) {
          return;
        }
      } catch {
        // Retry after a clean page reload below.
      }

      await page.keyboard.press("Escape").catch(() => undefined);
      if (attempt < 1) {
        await this.navigateToWikiPage(page, wikiUrl);
      }
    }

    throw new Error(
      `Failed to open delete confirmation from the sidebar tree for ${title}.`,
    );
  }

  private async findSidebarNode(page: Page, title: string) {
    const candidates = [
      page.locator(".workspace-tree-view-node-wrapper").filter({ hasText: title }).last(),
      page.locator(".workspace-tree-view-node").filter({ hasText: title }).last(),
      page.locator("li.catalogue__list-item").filter({ hasText: title }).last(),
      page.locator('[role="treeitem"]').filter({ hasText: title }).last(),
      page.locator('[role="item"]').filter({ hasText: title }).last(),
      page.locator("[data-id]").filter({ hasText: title }).last(),
    ];

    for (const [index, candidate] of candidates.entries()) {
      try {
        await candidate.waitFor({
          state: "visible",
          timeout:
            index === 0
              ? Math.min(this.config.playwrightActionTimeoutMs, 12000)
              : Math.min(this.config.playwrightActionTimeoutMs, 2000),
        });
        return candidate;
      } catch {
        // Try the next selector.
      }
    }

    throw new Error(`Cannot find sidebar tree node for ${title}.`);
  }

  private async navigateToWikiPage(page: Page, wikiUrl: string): Promise<void> {
    let lastError: unknown;
    const timeout = Math.max(this.config.playwrightActionTimeoutMs * 2, 30000);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await page.goto(wikiUrl, {
          waitUntil: "domcontentloaded",
          timeout,
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  private async confirmDeletion(page: Page): Promise<void> {
    const confirmButton = this.getDeleteConfirmButton(page);
    await confirmButton.waitFor({
      state: "visible",
      timeout: this.config.playwrightActionTimeoutMs,
    });
    await confirmButton.click();
  }

  private async waitForDeleteConfirmButton(
    page: Page,
    timeoutMs: number,
  ): Promise<boolean> {
    return await this.getDeleteConfirmButton(page)
      .waitFor({
        state: "visible",
        timeout: timeoutMs,
      })
      .then(() => true)
      .catch(() => false);
  }

  private getDeleteMenuItem(page: Page) {
    return page
      .locator('[role="menuitem"]:visible')
      .filter({ hasText: /^(Delete|删除)$/ })
      .first();
  }

  private getDeleteConfirmButton(page: Page) {
    return page
      .locator("button:visible")
      .filter({
        hasText: /^(Delete( and Return to Homepage)?|删除(并返回(首页|主页))?)$/,
      })
      .first();
  }

  private async captureLoginScreenshot(page: Page): Promise<string> {
    const screenshotPath = path.resolve(
      path.dirname(this.config.playwrightUserDataDir),
      "feishu-playwright-login-required.png",
    );
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    try {
      await page.screenshot({
        path: screenshotPath,
        fullPage: false,
        timeout: Math.min(this.config.playwrightActionTimeoutMs, 5000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      Logger.warn(
        `Failed to capture login-required screenshot for ${page.url()}: ${reason}`,
      );
      return `${screenshotPath} (capture failed: ${this.formatResponsePreview(reason)})`;
    }
    return screenshotPath;
  }

  private isLoginPage(url: string): boolean {
    return url.includes("/accounts/page/login") || url.includes("accounts.feishu.cn");
  }

  private isDeletedLandingPage(url: string): boolean {
    return url.includes("/drive/home/");
  }

  private inferBrowserFamilyFromExecutable(executablePath: string): BrowserFamily {
    return executablePath.toLowerCase().includes("firefox") ? "firefox" : "chromium";
  }

  private async resolveSystemBrowserCandidate(): Promise<BrowserLaunchTarget | null> {
    const envBrowser = process.env.BROWSER?.trim();
    if (envBrowser) {
      const resolved = await this.resolveExecutable(envBrowser);
      if (resolved) {
        return {
          family: this.inferBrowserFamilyFromExecutable(resolved),
          executablePath: resolved,
          source: "env:BROWSER",
        };
      }
    }

    const candidates: Array<{ family: BrowserFamily; source: string; commands: string[] }> = [];
    const defaultCandidate = await this.detectDefaultBrowserCandidate();
    if (defaultCandidate) {
      candidates.push(defaultCandidate);
    }
    candidates.push(...this.getCommonBrowserCandidates());

    for (const candidate of candidates) {
      for (const command of candidate.commands) {
        const resolved = await this.resolveExecutable(command);
        if (!resolved) continue;
        return {
          family: candidate.family,
          executablePath: resolved,
          source: candidate.source,
        };
      }
    }

    return null;
  }

  private async detectDefaultBrowserCandidate(): Promise<{
    family: BrowserFamily;
    source: string;
    commands: string[];
  } | null> {
    if (process.platform !== "linux") {
      return null;
    }

    try {
      const { stdout } = await execFile("xdg-settings", ["get", "default-web-browser"]);
      const desktopEntry = stdout.trim().toLowerCase();
      if (!desktopEntry) return null;

      const mapped = this.mapDesktopEntryToCandidate(desktopEntry);
      if (!mapped) return null;
      return {
        ...mapped,
        source: `system-default:${desktopEntry}`,
      };
    } catch {
      return null;
    }
  }

  private mapDesktopEntryToCandidate(
    desktopEntry: string,
  ): { family: BrowserFamily; commands: string[] } | null {
    if (desktopEntry.includes("firefox")) {
      return { family: "firefox", commands: ["firefox"] };
    }
    if (desktopEntry.includes("edge")) {
      return {
        family: "chromium",
        commands: ["microsoft-edge-stable", "microsoft-edge", "msedge"],
      };
    }
    if (desktopEntry.includes("brave")) {
      return {
        family: "chromium",
        commands: ["brave-browser", "brave-browser-stable"],
      };
    }
    if (desktopEntry.includes("vivaldi")) {
      return { family: "chromium", commands: ["vivaldi-stable", "vivaldi"] };
    }
    if (desktopEntry.includes("opera")) {
      return { family: "chromium", commands: ["opera"] };
    }
    if (desktopEntry.includes("chromium")) {
      return { family: "chromium", commands: ["chromium", "chromium-browser"] };
    }
    if (desktopEntry.includes("chrome")) {
      return {
        family: "chromium",
        commands: ["google-chrome-stable", "google-chrome", "chrome"],
      };
    }
    return null;
  }

  private getCommonBrowserCandidates(): Array<{
    family: BrowserFamily;
    source: string;
    commands: string[];
  }> {
    switch (process.platform) {
      case "darwin":
        return [
          {
            family: "chromium",
            source: "common:macos-chromium",
            commands: [
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium",
              "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
              "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            ],
          },
          {
            family: "firefox",
            source: "common:macos-firefox",
            commands: ["/Applications/Firefox.app/Contents/MacOS/firefox"],
          },
        ];
      case "win32": {
        const prefixes = [
          process.env["PROGRAMFILES"],
          process.env["PROGRAMFILES(X86)"],
          process.env["LOCALAPPDATA"],
        ].filter((value): value is string => Boolean(value));
        return [
          {
            family: "chromium",
            source: "common:windows-chromium",
            commands: prefixes.flatMap((prefix) => [
              path.join(prefix, "Google", "Chrome", "Application", "chrome.exe"),
              path.join(prefix, "Chromium", "Application", "chrome.exe"),
              path.join(prefix, "Microsoft", "Edge", "Application", "msedge.exe"),
              path.join(prefix, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
            ]),
          },
          {
            family: "firefox",
            source: "common:windows-firefox",
            commands: prefixes.map((prefix) =>
              path.join(prefix, "Mozilla Firefox", "firefox.exe"),
            ),
          },
        ];
      }
      default:
        return [
          {
            family: "chromium",
            source: "common:linux-chromium",
            commands: [
              "google-chrome-stable",
              "google-chrome",
              "chromium",
              "chromium-browser",
              "microsoft-edge-stable",
              "microsoft-edge",
              "brave-browser",
              "brave-browser-stable",
              "vivaldi-stable",
              "vivaldi",
              "opera",
            ],
          },
          {
            family: "firefox",
            source: "common:linux-firefox",
            commands: ["firefox"],
          },
        ];
    }
  }

  private async resolveExecutable(command: string): Promise<string | null> {
    const trimmed = command.trim();
    if (!trimmed) return null;

    if (path.isAbsolute(trimmed)) {
      return (await this.isExecutable(trimmed)) ? trimmed : null;
    }

    if (trimmed.includes(path.sep)) {
      const absolute = path.resolve(trimmed);
      return (await this.isExecutable(absolute)) ? absolute : null;
    }

    const resolver = process.platform === "win32" ? "where" : "which";
    try {
      const { stdout } = await execFile(resolver, [trimmed]);
      const resolved = stdout
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(Boolean);
      if (!resolved) return null;
      return (await this.isExecutable(resolved)) ? resolved : null;
    } catch {
      return null;
    }
  }

  private async isExecutable(targetPath: string): Promise<boolean> {
    try {
      const mode = process.platform === "win32" ? constants.F_OK : constants.X_OK;
      await access(targetPath, mode);
      return true;
    } catch {
      return false;
    }
  }

  private async withOperationLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.operationChain;
    let releaseCurrent: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    this.operationChain = previous.then(() => current);

    await previous;
    try {
      return await task();
    } finally {
      releaseCurrent?.();
    }
  }
}

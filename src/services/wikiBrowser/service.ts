import { mkdir } from "node:fs/promises";
import type { AppConfig } from "../../config.js";
import { Logger } from "../../logger.js";
import {
  inferBrowserFamilyFromExecutable,
  resolveSystemBrowserCandidate,
  type BrowserLaunchTarget,
} from "./browserDiscovery.js";
import {
  buildWikiUrl,
  describeDeleteTarget,
} from "./helpers.js";
import {
  deleteFromWikiPage,
  navigateToWikiPage,
} from "./pageActions.js";
import {
  deleteViaInternalApi,
  resolveDeleteContext,
} from "./spaceApi.js";
import { LoginRequiredError, WikiBrowserSessionManager } from "./sessionManager.js";
import type { DeleteWikiNodeInput } from "./types.js";

type PlaywrightModule = typeof import("playwright");

export class WikiBrowserDeletionService {
  private playwrightModulePromise?: Promise<PlaywrightModule>;
  private launchTargetPromise?: Promise<BrowserLaunchTarget>;
  private operationChain: Promise<void> = Promise.resolve();
  private readonly sessionManager: WikiBrowserSessionManager;

  constructor(private readonly config: AppConfig["feishu"]) {
    this.sessionManager = new WikiBrowserSessionManager(config);
  }

  async deleteWikiNode(input: DeleteWikiNodeInput): Promise<void> {
    await this.deleteWikiNodes([input]);
  }

  async shutdown(): Promise<void> {
    await this.sessionManager.shutdown();
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
        await this.sessionManager.shutdown();
      }
    });
  }

  private async resolveLaunchTarget(): Promise<BrowserLaunchTarget> {
    const explicitPath = this.config.playwrightExecutablePath?.trim();
    if (explicitPath) {
      return {
        family: inferBrowserFamilyFromExecutable(explicitPath),
        executablePath: explicitPath,
        source: "env:FEISHU_PLAYWRIGHT_EXECUTABLE_PATH",
      };
    }

    const systemCandidate = await resolveSystemBrowserCandidate();
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
    const targetLabel = describeDeleteTarget(this.config, input);
    const effectiveHeadless = this.sessionManager.resolveEffectiveHeadlessMode();
    if (this.sessionManager.shouldAttemptInteractiveLoginFirst(effectiveHeadless)) {
      await this.sessionManager.ensureInteractiveLoginReady(playwright, launchTarget, input);
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
      if (!this.sessionManager.canRunHeadedBrowser()) {
        throw new Error(
          `Headless wiki deletion requires login for ${targetLabel}, but no GUI display is available for interactive recovery. Automatic lightweight profile bootstrap needs one visible login first. Prepare a logged-in browser profile under FEISHU_PLAYWRIGHT_USER_DATA_DIR and keep FEISHU_PLAYWRIGHT_HEADLESS=true. Screenshot: ${error.screenshotPath}`,
          { cause: error },
        );
      }

      Logger.info(
        `Headless wiki deletion requires login for ${targetLabel}. Preparing a lightweight browser profile for one-time manual login.`,
      );
      await this.sessionManager.recoverLoginInteractively(playwright, launchTarget, input);

      try {
        await this.runDeleteAttempt(playwright, launchTarget, input, true);
      } catch (retryError) {
        if (retryError instanceof LoginRequiredError) {
          throw new Error(
            `Feishu login recovery completed, but the headless session is still unavailable for ${targetLabel}. Screenshot: ${retryError.screenshotPath}`,
            { cause: retryError },
          );
        }
        throw retryError;
      }
    }
  }

  private async runDeleteAttempt(
    playwright: PlaywrightModule,
    launchTarget: BrowserLaunchTarget,
    input: DeleteWikiNodeInput,
    headless: boolean,
  ): Promise<void> {
    const session = await this.sessionManager.getOrCreateSession(
      playwright,
      launchTarget,
      headless,
    );
    const targetLabel = describeDeleteTarget(this.config, input);
    try {
      session.page.setDefaultTimeout(this.config.playwrightActionTimeoutMs);
      await this.sessionManager.ensureAuthenticatedSession(session, targetLabel, headless);

      try {
        await deleteViaInternalApi(session, input, this.config);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        Logger.warn(
          `Internal wiki delete API failed for ${targetLabel}: ${message}. Falling back to UI automation.`,
        );
      }

      const fallbackContext = input.nodeToken?.trim()
        ? { nodeToken: input.nodeToken.trim(), title: input.title }
        : await resolveDeleteContext(session.page, input, this.config);
      const wikiUrl = buildWikiUrl(this.config, fallbackContext.nodeToken);
      await navigateToWikiPage(session.page, wikiUrl, this.config.playwrightActionTimeoutMs);
      await this.sessionManager.ensureLoggedIn(session.page, wikiUrl, targetLabel, headless);
      await deleteFromWikiPage(
        session.page,
        wikiUrl,
        input.title ?? fallbackContext.title,
        this.config.playwrightActionTimeoutMs,
      );
    } catch (error) {
      await this.sessionManager.resetReusableSessionIfMatches(session);
      throw error;
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

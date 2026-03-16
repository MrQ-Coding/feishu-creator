import { rm } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../../config.js";
import { Logger } from "../../logger.js";
import {
  bootstrapAutomationProfile,
  createTemporaryAutomationProfileDir,
  promoteAutomationProfile,
  resolveSystemBrowserProfileSeedSource,
} from "./playwrightProfileBootstrap.js";
import type { BrowserLaunchTarget } from "./browserDiscovery.js";
import { buildWikiHomeUrl, describeDeleteTarget, isLoginPage } from "./helpers.js";
import { captureLoginScreenshot, navigateToWikiPage } from "./pageActions.js";
import { hasActiveWebSession } from "./spaceApi.js";
import type { DeleteWikiNodeInput, ReusableBrowserSession } from "./types.js";

type PlaywrightModule = typeof import("playwright");

interface LoginRecoveryProfile {
  cleanup: () => Promise<void>;
  persist: () => Promise<void>;
  sourceLabel: string;
  userDataDir: string;
}

export class LoginRequiredError extends Error {
  constructor(
    message: string,
    readonly screenshotPath: string,
  ) {
    super(message);
    this.name = "LoginRequiredError";
  }
}

export class WikiBrowserSessionManager {
  private reusableSession?: ReusableBrowserSession;
  private cleanupHooksRegistered = false;

  constructor(private readonly config: AppConfig["feishu"]) {
    this.registerProcessCleanupHooks();
  }

  async shutdown(): Promise<void> {
    await this.closeReusableSession();
  }

  resolveEffectiveHeadlessMode(): boolean {
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

  shouldAttemptInteractiveLoginFirst(headless: boolean): boolean {
    return (
      headless &&
      this.config.playwrightLoginRecoveryMode === "interactive_first" &&
      this.canRunHeadedBrowser()
    );
  }

  canRunHeadedBrowser(): boolean {
    if (process.platform !== "linux") {
      return true;
    }
    return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  }

  async ensureInteractiveLoginReady(
    playwright: PlaywrightModule,
    launchTarget: BrowserLaunchTarget,
    input: DeleteWikiNodeInput,
  ): Promise<void> {
    const targetLabel = describeDeleteTarget(this.config, input);
    const session = await this.getOrCreateSession(playwright, launchTarget, true);
    if (await hasActiveWebSession(session, this.config)) {
      return;
    }

    Logger.info(
      `No active Feishu web session for ${targetLabel}. Opening a visible browser for manual login before deletion.`,
    );
    await this.recoverLoginInteractively(playwright, launchTarget, input);
  }

  async ensureLoggedIn(
    page: Page,
    wikiUrl: string,
    title?: string,
    headless = this.config.playwrightHeadless,
  ): Promise<void> {
    if (!isLoginPage(page.url())) {
      return;
    }

    if (headless) {
      const screenshotPath = await captureLoginScreenshot(
        page,
        this.config.playwrightUserDataDir,
        this.config.playwrightActionTimeoutMs,
      );
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
    await navigateToWikiPage(page, wikiUrl, this.config.playwrightActionTimeoutMs);

    if (isLoginPage(page.url())) {
      throw new Error(`Feishu login did not complete for ${title ?? wikiUrl}.`);
    }
  }

  async recoverLoginInteractively(
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

  async getOrCreateSession(
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

  async resetReusableSessionIfMatches(
    session: ReusableBrowserSession,
  ): Promise<void> {
    if (this.reusableSession !== session) {
      return;
    }
    await this.closeReusableSession();
  }

  async ensureAuthenticatedSession(
    session: ReusableBrowserSession,
    targetLabel: string,
    headless: boolean,
  ): Promise<void> {
    if (await hasActiveWebSession(session, this.config)) {
      return;
    }

    const sessionUrl = buildWikiHomeUrl(this.config);
    await navigateToWikiPage(session.page, sessionUrl, this.config.playwrightActionTimeoutMs);
    await this.ensureLoggedIn(session.page, sessionUrl, targetLabel, headless);

    if (!(await hasActiveWebSession(session, this.config))) {
      throw new Error(`Feishu web session is unavailable for ${targetLabel}.`);
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
    const sessionUrl = buildWikiHomeUrl(this.config);
    const targetLabel = describeDeleteTarget(this.config, input);
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      page.setDefaultTimeout(this.config.playwrightActionTimeoutMs);
      await navigateToWikiPage(page, sessionUrl, this.config.playwrightActionTimeoutMs);
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
}

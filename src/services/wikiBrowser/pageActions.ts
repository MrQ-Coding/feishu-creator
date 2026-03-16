import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { Logger } from "../../logger.js";
import { formatResponsePreview, isDeletedLandingPage } from "./helpers.js";

export async function deleteFromWikiPage(
  page: Page,
  wikiUrl: string,
  title: string | undefined,
  actionTimeoutMs: number,
): Promise<void> {
  if (title) {
    try {
      await openDeleteConfirmationFromSidebar(page, wikiUrl, title, actionTimeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.warn(
        `Sidebar wiki deletion path failed for ${title}: ${message}. Falling back to the document menu.`,
      );
    }
  }

  if (!(await waitForDeleteConfirmButton(page, 2000))) {
    await openDeleteConfirmationFromTopMenu(page, wikiUrl, actionTimeoutMs);
  }
  await confirmDeletion(page, actionTimeoutMs);

  try {
    await page.waitForFunction(
      ([originalUrl, pageTitle]) => {
        if (location.href !== originalUrl) return true;
        if (!pageTitle) return false;
        return !document.body.innerText.includes(pageTitle);
      },
      [wikiUrl, title ?? ""],
      {
        timeout: actionTimeoutMs,
      },
    );
  } catch (error) {
    try {
      await page.waitForURL(/\/drive\/home\/?/, {
        timeout: actionTimeoutMs,
      });
      return;
    } catch {
      if (isDeletedLandingPage(page.url())) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Playwright delete confirmation did not finish for ${title ?? page.url()}: ${message}`,
      );
    }
  }
}

export async function navigateToWikiPage(
  page: Page,
  wikiUrl: string,
  actionTimeoutMs: number,
): Promise<void> {
  let lastError: unknown;
  const timeout = Math.max(actionTimeoutMs * 2, 30000);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(wikiUrl, {
        waitUntil: "domcontentloaded",
        timeout,
      });
      await page.waitForLoadState("domcontentloaded", {
        timeout: Math.min(actionTimeoutMs, 5000),
      }).catch(() => undefined);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await page.waitForTimeout(250 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

export async function captureLoginScreenshot(
  page: Page,
  userDataDir: string,
  actionTimeoutMs: number,
): Promise<string> {
  const screenshotPath = path.resolve(
    path.dirname(userDataDir),
    "feishu-playwright-login-required.png",
  );
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  try {
    await page.screenshot({
      path: screenshotPath,
      fullPage: false,
      timeout: Math.min(actionTimeoutMs, 5000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    Logger.warn(
      `Failed to capture login-required screenshot for ${page.url()}: ${reason}`,
    );
    return `${screenshotPath} (capture failed: ${formatResponsePreview(reason)})`;
  }
  return screenshotPath;
}

async function openDeleteConfirmationFromTopMenu(
  page: Page,
  wikiUrl: string,
  actionTimeoutMs: number,
): Promise<void> {
  const moreButton = page.locator('button[data-e2e="suite-more-btn"]');
  await moreButton.waitFor({
    state: "visible",
    timeout: actionTimeoutMs,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await moreButton.click();
      const deleteItem = getDeleteMenuItem(page);
      await deleteItem.waitFor({
        state: "visible",
        timeout: Math.min(actionTimeoutMs, 4000),
      });
      await deleteItem.click();

      if (await waitForDeleteConfirmButton(page, 4000)) {
        return;
      }
    } catch {
      // Retry after a clean page reload below.
    }

    await page.keyboard.press("Escape").catch(() => undefined);
    if (attempt < 2) {
      await navigateToWikiPage(page, wikiUrl, actionTimeoutMs);
      await moreButton.waitFor({
        state: "visible",
        timeout: actionTimeoutMs,
      });
    }
  }

  throw new Error(
    `Failed to open delete confirmation from the document menu for ${page.url()}.`,
  );
}

async function openDeleteConfirmationFromSidebar(
  page: Page,
  wikiUrl: string,
  title: string,
  actionTimeoutMs: number,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const node = await findSidebarNode(page, title, actionTimeoutMs);
      await node.scrollIntoViewIfNeeded();
      await node.hover();

      let moreButton = node.locator(".more-operate-btn").last();
      if ((await moreButton.count()) <= 0) {
        moreButton = page.locator(".workspace-tree-view-node--hovered .more-operate-btn").last();
      }

      await moreButton.waitFor({
        state: "visible",
        timeout: Math.min(actionTimeoutMs, 3000),
      });
      await moreButton.click();

      const deleteItem = getDeleteMenuItem(page);
      await deleteItem.waitFor({
        state: "visible",
        timeout: Math.min(actionTimeoutMs, 4000),
      });
      await deleteItem.click();

      if (await waitForDeleteConfirmButton(page, 4000)) {
        return;
      }
    } catch {
      // Retry after a clean page reload below.
    }

    await page.keyboard.press("Escape").catch(() => undefined);
    if (attempt < 1) {
      await navigateToWikiPage(page, wikiUrl, actionTimeoutMs);
    }
  }

  throw new Error(
    `Failed to open delete confirmation from the sidebar tree for ${title}.`,
  );
}

async function findSidebarNode(
  page: Page,
  title: string,
  actionTimeoutMs: number,
): Promise<Locator> {
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
            ? Math.min(actionTimeoutMs, 12000)
            : Math.min(actionTimeoutMs, 2000),
      });
      return candidate;
    } catch {
      // Try the next selector.
    }
  }

  throw new Error(`Cannot find sidebar tree node for ${title}.`);
}

async function confirmDeletion(page: Page, actionTimeoutMs: number): Promise<void> {
  const confirmButton = getDeleteConfirmButton(page);
  await confirmButton.waitFor({
    state: "visible",
    timeout: actionTimeoutMs,
  });
  await confirmButton.click();
}

async function waitForDeleteConfirmButton(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  return await getDeleteConfirmButton(page)
    .waitFor({
      state: "visible",
      timeout: timeoutMs,
    })
    .then(() => true)
    .catch(() => false);
}

function getDeleteMenuItem(page: Page): Locator {
  return page
    .locator('[role="menuitem"]:visible')
    .filter({ hasText: /^(Delete|删除)$/ })
    .first();
}

function getDeleteConfirmButton(page: Page): Locator {
  return page
    .locator("button:visible")
    .filter({
      hasText: /^(Delete( and Return to Homepage)?|删除(并返回(首页|主页))?)$/,
    })
    .first();
}

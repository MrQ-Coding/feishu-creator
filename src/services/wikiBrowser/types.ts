import type { BrowserContext, Page } from "playwright";

export interface DeleteWikiNodeInput {
  nodeToken?: string;
  documentId?: string;
  spaceId?: string;
  title?: string;
}

export interface WikiDeleteContext {
  nodeToken: string;
  spaceId: string;
  title?: string;
}

export interface ReusableBrowserSession {
  context: BrowserContext;
  page: Page;
  headless: boolean;
  launchSignature: string;
}

export interface SpaceApiEnvelope<TData> {
  code?: number;
  msg?: string;
  data?: TData | null;
}

export interface SpaceApiRequest {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}

export interface SpaceApiResponse<TData> {
  status: number;
  text: string;
  json: SpaceApiEnvelope<TData> | null;
  csrfToken?: string;
}

export interface InternalWikiNodeData {
  space_id?: string;
  wiki_token?: string;
  title?: string;
  obj_token?: string;
}

export interface InternalDeleteNodeData {
  task_id?: string;
  need_apply?: boolean;
  reviewer?: unknown;
  users?: unknown;
}

export interface CurrentWikiContext {
  spaceId?: string;
  nodeToken?: string;
  documentId?: string;
  title?: string;
}

export const INTERNAL_API_SUCCESS_CODE = 0;
export const INTERNAL_DELETE_SOURCE_NOT_EXIST_CODE = 920004002;
export const INTERNAL_GET_NODE_NOT_FOUND_CODE = 920004123;

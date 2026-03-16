import type { UploadLocalImageResult } from "../documentEdit/index.js";

export type DiagramImageFormat = "png" | "svg";
export type GraphvizLayoutEngine =
  | "dot"
  | "neato"
  | "fdp"
  | "sfdp"
  | "twopi"
  | "circo";

export interface RenderGraphvizDiagramInput {
  sourceText: string;
  format?: DiagramImageFormat;
  outputPath?: string;
  layoutEngine?: GraphvizLayoutEngine;
}

export interface RenderPlantUmlDiagramInput {
  sourceText: string;
  format?: DiagramImageFormat;
  outputPath?: string;
}

export interface RenderDiagramImageResult {
  sourceType: "graphviz" | "plantuml";
  format: DiagramImageFormat;
  outputPath: string;
  renderer: string;
}

export interface CreateGraphvizDiagramBlockInput extends RenderGraphvizDiagramInput {
  documentId: string;
  parentBlockId?: string;
  replaceBlockId?: string;
  index?: number;
  fileName?: string;
  cleanupGeneratedFile?: boolean;
  width?: number;
  height?: number;
  documentRevisionId?: number;
}

export interface CreatePlantUmlDiagramBlockInput extends RenderPlantUmlDiagramInput {
  documentId: string;
  parentBlockId?: string;
  replaceBlockId?: string;
  index?: number;
  fileName?: string;
  cleanupGeneratedFile?: boolean;
  width?: number;
  height?: number;
  documentRevisionId?: number;
}

export interface CreateDiagramImageBlockResult {
  render: RenderDiagramImageResult;
  upload: UploadLocalImageResult;
  cleanupGeneratedFile: boolean;
}

export interface RendererCommand {
  command: string;
  args: string[];
  label: string;
}

export interface NormalizedRenderInput {
  sourceText: string;
  format: DiagramImageFormat;
  outputPath: string;
}

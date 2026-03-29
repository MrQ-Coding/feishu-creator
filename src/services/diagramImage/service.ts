import { rm } from "node:fs/promises";
import type { AppConfig } from "../../config.js";
import type { DocumentEditService } from "../documentEdit/index.js";
import {
  ensurePlantUmlDocument,
  normalizeRenderInput,
  resolveGraphvizCommand,
  resolvePlantUmlCommand,
  runRendererCommand,
} from "./rendering.js";
import type {
  CreateDiagramImageBlockResult,
  CreateGraphvizDiagramBlockInput,
  CreatePlantUmlDiagramBlockInput,
  RenderDiagramImageResult,
  RenderGraphvizDiagramInput,
  RenderPlantUmlDiagramInput,
} from "./types.js";

export type {
  CreateDiagramImageBlockResult,
  CreateGraphvizDiagramBlockInput,
  CreatePlantUmlDiagramBlockInput,
  DiagramImageFormat,
  GraphvizLayoutEngine,
  RenderDiagramImageResult,
  RenderGraphvizDiagramInput,
  RenderPlantUmlDiagramInput,
} from "./types.js";

export class DiagramImageService {
  constructor(
    private readonly documentEditService: DocumentEditService,
    private readonly config: AppConfig["feishu"],
  ) {}

  async renderGraphvizToImage(
    input: RenderGraphvizDiagramInput,
  ): Promise<RenderDiagramImageResult> {
    const normalized = normalizeRenderInput(input, "graphviz");
    const layoutEngine = input.layoutEngine ?? "dot";
    const command = await resolveGraphvizCommand(this.config);
    await runRendererCommand(
      {
        command,
        args: [`-K${layoutEngine}`, `-T${normalized.format}`, `-Gdpi=200`],
        label: "Graphviz",
      },
      normalized.sourceText,
      normalized.outputPath,
    );
    return {
      sourceType: "graphviz",
      format: normalized.format,
      outputPath: normalized.outputPath,
      renderer: command,
    };
  }

  async renderPlantUmlToImage(
    input: RenderPlantUmlDiagramInput,
  ): Promise<RenderDiagramImageResult> {
    const normalized = normalizeRenderInput(input, "plantuml");
    const command = await resolvePlantUmlCommand(this.config);
    await runRendererCommand(
      {
        command: command.command,
        args: [
          ...command.args,
          normalized.format === "svg" ? "-tsvg" : "-tpng",
          "-pipe",
          "-Sdpi=200",
        ],
        label: "PlantUML",
      },
      ensurePlantUmlDocument(normalized.sourceText),
      normalized.outputPath,
    );
    return {
      sourceType: "plantuml",
      format: normalized.format,
      outputPath: normalized.outputPath,
      renderer: [command.command, ...command.args].join(" "),
    };
  }

  async createGraphvizImageBlock(
    input: CreateGraphvizDiagramBlockInput,
  ): Promise<CreateDiagramImageBlockResult> {
    return this.createDiagramImageBlock(
      {
        ...input,
        format: "png",
      },
      (renderInput) => this.renderGraphvizToImage(renderInput),
      input.fileName ?? "graphviz-diagram.png",
    );
  }

  async createPlantUmlImageBlock(
    input: CreatePlantUmlDiagramBlockInput,
  ): Promise<CreateDiagramImageBlockResult> {
    return this.createDiagramImageBlock(
      {
        ...input,
        format: "png",
      },
      (renderInput) => this.renderPlantUmlToImage(renderInput),
      input.fileName ?? "plantuml-diagram.png",
    );
  }

  private async createDiagramImageBlock(
    input:
      | CreateGraphvizDiagramBlockInput
      | CreatePlantUmlDiagramBlockInput,
    renderImage: (
      renderInput: RenderGraphvizDiagramInput | RenderPlantUmlDiagramInput,
    ) => Promise<RenderDiagramImageResult>,
    defaultFileName: string,
  ): Promise<CreateDiagramImageBlockResult> {
    const cleanupGeneratedFile = input.cleanupGeneratedFile ?? true;
    const render = await renderImage({
      sourceText: input.sourceText,
      format: "png",
      outputPath: input.outputPath,
      ...(isGraphvizBlockInput(input) && input.layoutEngine
        ? { layoutEngine: input.layoutEngine }
        : {}),
    });

    try {
      const upload = await this.documentEditService.uploadLocalImage({
        documentId: input.documentId,
        imagePath: render.outputPath,
        replaceBlockId: input.replaceBlockId,
        parentBlockId: input.parentBlockId,
        index: input.index,
        fileName: input.fileName ?? defaultFileName,
        width: input.width,
        height: input.height,
        documentRevisionId: input.documentRevisionId ?? -1,
      });
      return {
        render,
        upload,
        cleanupGeneratedFile,
      };
    } finally {
      if (cleanupGeneratedFile) {
        await rm(render.outputPath, { force: true }).catch(() => undefined);
      }
    }
  }
}

function isGraphvizBlockInput(
  input: CreateGraphvizDiagramBlockInput | CreatePlantUmlDiagramBlockInput,
): input is CreateGraphvizDiagramBlockInput {
  return "layoutEngine" in input;
}

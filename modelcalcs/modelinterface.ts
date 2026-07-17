import { vec3, vec4 } from "gl-matrix";
import { createModelFromXml, type ModelParseOptions } from "./models";
import { GetNodeResult, ModelChannelMapping } from "./modelbase";
import { BaseModelClass } from "./modelshared";
import {
    OutputManager,
    ResolvedModelWithMapping,
    parseNetworksXml,
    resolveAllModelChannels,
    extractModelChannelInfo,
    enrichWithChannels,
    computeChannelRoles,
} from "./channels";
import { getElementsByTagRecursive } from "./utils";
import { DmxModel } from "./dmx";
import type { ImageModel } from "./image";
import type { MhBeamParams, MhWorldTransform } from "./mhbeam";
import type { MhDefinition } from "./mhdef";

/**
 * Get coordinates for a single model element.
 * Does not include channel info - use getAllModelCoordinates for that.
 */
export function getModelCoordinates(model: Element, do2DProj: boolean = false, options?: ModelParseOptions): GetNodeResult {
    const modelObj = createModelFromXml(model, options);
    return getModelCoordinatesFromObj(modelObj, do2DProj);
}

/**
 * Get coordinates for a model object, applying world transform.
 */
function getModelCoordinatesFromObj(modelObj: BaseModelClass, do2DProj: boolean = false): GetNodeResult {
    // Generate nodes
    const nr = modelObj.getNodeCoords();

    // Convert to world coords
    const matrix = do2DProj ? nr.toWorld2DCoords : nr.toWorldCoords;

    for (const n of nr.nodes) {
        for (const c of n.coords) {
            const v = vec3.fromValues(c.modelX, c.modelY, c.modelZ);
            const res = vec4.create();
            vec4.transformMat4(res, vec4.fromValues(v[0], v[1], v[2], 1.0), matrix);
            c.wX = res[0];
            c.wY = res[1];
            c.wZ = res[2];
        }
    }

    nr.modelType = modelObj.getType();
    nr.pixelSize = modelObj.pixelSize;
    nr.pixelStyle = ["Square", "Smooth", "Solid Circle", "Blended Circle"][modelObj.antialias ?? 1] ?? "Solid Circle";
    nr.pixelType = modelObj.pixelType;
    nr.pixelSpacing = modelObj.pixelSpacing;
    nr.transparency = modelObj.transparency;
    nr.stringType = modelObj.stringType;
    nr.layoutGroup = modelObj.layoutGroup || undefined;

    nr.colorProfile = modelObj.dimmingCurve;

    // Per-channel render contribution — lets preview consumers turn raw
    // frame bytes into RGB without re-parsing StringType.
    nr.channelRoles = computeChannelRoles(
        modelObj.stringType,
        modelObj.customColor,
        modelObj.superStringColours,
    );

    // Image-specific data for preview (path, off-brightness, alpha, tint).
    // Match by getType() (matches ImageModelType.typeName) rather than
    // instanceof so the check survives bundler / multi-realm boundaries.
    if (modelObj.getType() === 'Image') {
        const im = modelObj as ImageModel;
        nr.imageInfo = {
            imageFile: im.imageFile,
            offBrightness: im.offBrightness,
            whiteAsAlpha: im.whiteAsAlpha,
        };
        if (im.customColor && im.customColor !== '#000000') {
            nr.imageInfo.customColor = im.customColor;
        }
    }

    return nr;
}

// ============================================================================
// All-models processing with channel resolution
// ============================================================================

export interface ModelResult {
    name: string;
    active: boolean;
    nodeResult: GetNodeResult;
    channelMapping: ModelChannelMapping;
}

export interface AllModelsResult {
    models: Map<string, ModelResult>;
    outputManager: OutputManager;
    totalChannels: number;
}

/**
 * Result of the shared parse-and-resolve phase (see
 * `parseModelsAndResolveChannels`).
 */
export interface ParsedModelsWithChannels {
    outputManager: OutputManager;
    /** Successfully parsed model objects, in document order. */
    modelObjs: BaseModelClass[];
    /** Channel resolution per model name (absent = channels unresolvable). */
    resolvedChannels: Map<string, ResolvedModelWithMapping>;
}

/**
 * Shared first phase of whole-layout processing: parse the networks XML into
 * an OutputManager, create model objects for every `<model>` element
 * (unknown/unparseable models are non-fatal: warn via `options.logger` and
 * skip), then resolve start channels for all of them (handles `!controller`,
 * `#universe`, `>model`/`@model` dependency forms).
 *
 * `getAllModelCoordinates` layers geometry on top of this; consumers that
 * only need channel-mapping data (e.g. `getControllersAndModelChannels`)
 * can use it directly.
 */
export function parseModelsAndResolveChannels(
    rgbeffectsDoc: Document,
    networksDoc: Document,
    options?: ModelParseOptions,
): ParsedModelsWithChannels {
    // Parse networks to get output/controller info
    const outputManager = parseNetworksXml(networksDoc);

    // Find all model elements
    const modelElements = getElementsByTagRecursive(rgbeffectsDoc, 'model');

    const log = options?.logger ?? ((msg: string) => console.warn(msg));

    // Create model objects.  Unknown/unparseable models (e.g. a DisplayAs
    // added upstream that this library doesn't implement yet) are non-fatal
    // for whole-layout loading: warn and skip, keep processing the rest.
    // (Single-model entry points — createModelFromXml / getModelCoordinates —
    // still throw: a caller asking for one specific model deserves the error.)
    const modelObjs: BaseModelClass[] = [];
    for (const elem of modelElements) {
        try {
            const modelObj = createModelFromXml(elem, options);
            modelObjs.push(modelObj);
        } catch (e) {
            log(`Warning: skipping model "${elem.getAttribute('name') ?? '?'}": ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // Resolve channels for all models (handles dependencies).  Route
    // resolution warnings (bad StartChannel strings, missing controllers,
    // circular deps) through the caller's logger.
    const modelInfos = modelObjs.map(m => extractModelChannelInfo(m));
    const resolvedChannels = resolveAllModelChannels(modelInfos, outputManager, log);

    return { outputManager, modelObjs, resolvedChannels };
}

/**
 * Process all models from rgbeffects XML with channel resolution.
 *
 * This is the main entry point for getting complete model data including
 * world coordinates and channel mappings.
 *
 * @param rgbeffectsDoc Parsed xlights_rgbeffects.xml document
 * @param networksDoc Parsed xlights_networks.xml document
 * @param do2DProj Use 2D projection matrix (for top-down view)
 * @returns All models with coordinates and channel info
 *
 * @example
 * ```typescript
 * const result = getAllModelCoordinates(rgbeffectsDoc, networksDoc);
 *
 * // Access a specific model
 * const arch = result.models.get('South Arch');
 * if (arch) {
 *     for (const node of arch.nodeResult.nodes) {
 *         console.log(`Node ${node.physicalNum}: channel ${node.channel}`);
 *         for (const coord of node.coords) {
 *             console.log(`  World: (${coord.wX}, ${coord.wY}, ${coord.wZ})`);
 *         }
 *     }
 * }
 * ```
 */
export function getAllModelCoordinates(
    rgbeffectsDoc: Document,
    networksDoc: Document,
    do2DProj: boolean = false,
    options?: ModelParseOptions,
): AllModelsResult {
    const { outputManager, modelObjs, resolvedChannels } =
        parseModelsAndResolveChannels(rgbeffectsDoc, networksDoc, options);

    const log = options?.logger ?? ((msg: string) => console.warn(msg));

    // Build results with coordinates and channels
    const models = new Map<string, ModelResult>();

    for (const modelObj of modelObjs) {
        const resolved = resolvedChannels.get(modelObj.name);
        if (!resolved) {
            log(`Warning: channels not resolved for model: ${modelObj.name}`);
            continue;
        }

        // Get coordinates with world transform
        const nodeResult = getModelCoordinatesFromObj(modelObj, do2DProj);

        // Enrich with channel info
        enrichWithChannels(nodeResult, resolved.channelMapping);

        models.set(modelObj.name, {
            name: modelObj.name,
            active: modelObj.active,
            nodeResult,
            channelMapping: resolved.channelMapping,
        });
    }

    return {
        models,
        outputManager,
        totalChannels: outputManager.totalChannels,
    };
}

// ============================================================================
// Moving Head fixture extraction
// ============================================================================

/**
 * Complete fixture descriptor for a DMX moving head.
 * Contains everything needed to compute beam position/color from frame data.
 */
export interface MhFixtureInfo {
    /** Model name as defined in xLights */
    name: string;
    /** Motor, color, dimmer, and shutter definitions */
    definition: MhDefinition;
    /** Beam geometry parameters (cone angle, length, y-offset) */
    beamParams: MhBeamParams;
    /** World transform (position, rotation, scale) */
    worldTransform: MhWorldTransform;
    /** 0-based start channel of this fixture in the full frame buffer */
    channelOffset: number;
    /** Number of DMX channels for this fixture */
    numChannels: number;
}

/**
 * Extract all moving head fixtures from the layout XML.
 * Identifies MH models by the presence of a parsed mhDefinition (not DisplayAs).
 *
 * Returns an array of MhFixtureInfo for each moving head found in
 * xlights_rgbeffects.xml, with resolved channel offsets from xlights_networks.xml.
 */
export function getAllMovingHeads(
    rgbeffectsDoc: Document,
    networksDoc: Document,
    options?: ModelParseOptions,
): MhFixtureInfo[] {
    // Resolve channel mappings for all models (needed for channelOffset).
    // Suppress unused-attr warnings on this internal pass — getAllMovingHeads
    // is typically called alongside getAllModelCoordinates, which already
    // emitted them once.  Caller can override via `options`.
    const allModels = getAllModelCoordinates(rgbeffectsDoc, networksDoc, false, {
        warnUnusedAttrs: false,
        ...options,
    });

    const result: MhFixtureInfo[] = [];
    const modelElements = getElementsByTagRecursive(rgbeffectsDoc, 'model');

    for (const elem of modelElements) {
        const name = elem.getAttribute('name') ?? '';
        if (!name) continue;

        const modelResult = allModels.models.get(name);
        if (!modelResult) continue;

        let modelObj: BaseModelClass;
        try {
            modelObj = createModelFromXml(elem, { warnUnusedAttrs: false, ...options });
        } catch (e) {
            continue;  // Not parseable — skip
        }

        const dmxModel = modelObj as DmxModel;
        if (!dmxModel.mhDefinition) continue;

        result.push({
            name,
            definition: dmxModel.mhDefinition,
            beamParams: {
                dmxBeamWidth: dmxModel.dmxBeamWidth,
                dmxBeamLength: dmxModel.dmxBeamLength,
                dmxBeamYOffset: dmxModel.dmxBeamYOffset,
                dmxBeamLimit: dmxModel.dmxBeamLimit,
                meshWidth: dmxModel.meshWidth,
                meshHeight: dmxModel.meshHeight,
                meshDepth: dmxModel.meshDepth,
            },
            worldTransform: {
                worldPosX: dmxModel.worldPosX,
                worldPosY: dmxModel.worldPosY,
                worldPosZ: dmxModel.worldPosZ,
                rotateX: dmxModel.rotateX,
                rotateY: dmxModel.rotateY,
                rotateZ: dmxModel.rotateZ,
                scaleX: dmxModel.scaleX,
                scaleY: dmxModel.scaleY,
                scaleZ: dmxModel.scaleZ,
            },
            channelOffset: modelResult.channelMapping.firstChannel,
            numChannels: dmxModel.numChannels,
        });
    }

    return result;
}


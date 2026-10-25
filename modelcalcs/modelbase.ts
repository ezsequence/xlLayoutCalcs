import type { mat4 } from "gl-matrix";

export interface ModelProperty {
    /** Logical property name (a human label; often equals xmlName). */
    name: string;
    ptype: "BOOL" | "INTEGER" | "FLOAT" | "STRING" | "NODE_ARRAY";
    /** XML attribute the deserializer reads — in the x2026_3+ schema. */
    xmlName: string;
    /** TS/JS field on the model class the value is assigned to. */
    fieldName?: string;
    description: string;

    deprecated?: boolean;
}

export interface BaseModel {
    name: string;
    getProperties(): ModelProperty[];
    getNumNodes(): number;
    getNodeCoords(): GetNodeResult;
    getBufferDescription(ind: EffectBufferDescriptionInput): EffectBufferDescriptionOutput;
    getType(): string;
}

export interface ModelType {
    typeName: string; // Our type
    displayAs: string; // xLights DA type
    modelXmlTag: string; // .xmodel xml tag
}

export interface EffectBufferDescriptionInput {
    style:
        "Default" |
        "Single Line" |
        "As Pixel" |
        "Per Preview" |
        "Vertical Per Strand" |
        "Horizontal Per Strand" |
        "Horizontal Per Model/Strand" |
        "Vertical Per Model/Strand" |
        "Per Preview No Offset";
    perModel: boolean;
}

export interface EffectBufferDescriptionOutput {
    dense: boolean;
    width: number;
    height: number;
    direction: "H" | "V";
    zigzag: boolean;
    alternate: boolean;
    startLeft: boolean;
    startUpper: boolean;
    startInner: boolean;
}

export interface NodeCoord {
    // For the default / logical render buffer (arguably a separate concern
    // from the spatial coordinates below)
    bufX: number;
    bufY: number;
    bufZ: number;

    // In 3D space, prop relative not world
    modelX: number;
    modelY: number;
    modelZ: number;

    // World
    wX: number;
    wY: number;
    wZ: number;
}

export interface NodeLoc {
    physicalNum: number; // Number 1-n, based on wiring
    physicalStrand: number; // 0-based strand number, for models that have strands; affects some render styles
    physicalNumOnStrand: number; // Physical pixel num on strand, 0-sl

    logicalNum: number; // Number logical to a model type, regardless of how it is wired, for example top to bottom left to right
    logicalX: number; // Commonly, the column in a grid
    logicalY: number; // Commonly, the row in a grid
    logicalZ: number; // Commonly, the grid sheet

    coords: NodeCoord[];

    // Channel info (populated after channel resolution)
    channel?: number;  // 0-based absolute channel (matches xLights model export)
}

/**
 * What a single channel within a node contributes to the rendered output.
 *
 * For 'red' / 'green' / 'blue' / 'white' / 'warmWhite' the tint is implicit
 * (#ff0000, #00ff00, #0000ff, #ffffff, #ffe5cc) and `tint` is omitted —
 * value × implicit-tint adds into the node's RGB.
 *
 * For 'intensity' (single-color models) and 'tint' (superstring per-color
 * channels) the tint is explicit — value × tint adds into the node's RGB.
 *
 * For 'unused' the channel exists in the wiring but does not contribute.
 */
export type ChannelRoleKind =
    | 'red' | 'green' | 'blue' | 'white' | 'warmWhite'
    | 'intensity'
    | 'tint'
    | 'unused';

export interface ChannelRole {
    /** 0-based offset of this channel within the node. */
    offset: number;
    kind: ChannelRoleKind;
    /** Hex color (e.g. '#ff8000'); required for 'intensity' and 'tint',
     *  omitted for the named-color kinds. */
    tint?: string;
}

/**
 * Image-model-specific data needed to render the model in a preview.
 * Present on GetNodeResult only when modelType === 'Image'.
 */
export interface ImageInfo {
    /** Path to the image file as recorded in xLights (may be absolute, may
     *  use backslashes on Windows; consumers are responsible for resolving). */
    imageFile: string;
    /** Brightness floor (0–100) applied when the controlling channel is 0. */
    offBrightness: number;
    /** When true, treat near-white pixels as transparent. */
    whiteAsAlpha: boolean;
    /** Hex tint applied across the whole image for "Single Color Custom"
     *  StringType. Omitted otherwise. */
    customColor?: string;
}

export interface NodeColorProfile {
    // Brightness values are 0-1-? (multiplier, where 1 does nothing)
    allBrightness ?: number,
    // Gamma values are exponents, where 1 does nothing
    allGamma?: number,

    rBrightness?: number,
    rGamma?: number,
    gBrightness?: number,
    gGamma?: number,
    bBrightness?: number,
    bGamma?: number,
}

// ============================================================================
// Channel Mapping Types
// ============================================================================

/**
 * A contiguous run of nodes mapped to channels.
 * Most models have a single run; Advanced mode models may have multiple.
 *
 * All channel numbers are 0-based (matching xLights model export).
 */
export interface ChannelRun {
    nodeStart: number;       // First node index in this run (0-based)
    nodeCount: number;       // Number of nodes in this run
    channelStart: number;    // First channel (0-based)
    channelsPerNode: number; // 3=RGB, 4=RGBW, 1=single color, etc.
    stringIndex: number;     // Which string/strand this run belongs to (0-based)
}

/**
 * Complete channel mapping for a model.
 * Maps from node index space to channel space.
 *
 * All channel numbers are 0-based (matching xLights model export).
 */
export interface ModelChannelMapping {
    nodeChannelMap: ChannelRun[];  // Usually just 1, but multiple for Advanced mode
    totalNodes: number;            // Total nodes in model
    totalChannels: number;         // Sum of nodeCount * channelsPerNode across runs
    channelsPerNode: number;       // Default/common value from StringType
    numStrings: number;            // Number of strings in the model

    // Convenience: overall channel bounds (0-based)
    firstChannel: number;          // Min channel used
    lastChannel: number;           // Max channel used
}

// ============================================================================
// Node Coordinate Results
// ============================================================================

/**
 * The return of getNodeCoords.
 * We are making a different abstraction than xLights.
 *   Coordinates in nodes[] is normalized / logical
 * Thus the attachment of some of the physical transformation
 *   A good bit more of that was already done by xLights
 */
export interface GetNodeResult {
    nodes: NodeLoc[];

    /** Matrix to transform model coordinates to 3D world coordinates */
    toWorldCoords: mat4;

    /** Matrix to transform model coordinates to 2D world coordinates (with perspective tilt) */
    toWorld2DCoords: mat4;

    logicalBufferWidth: number;
    logicalBufferHeight: number;
    logicalBufferDepth: number;

    /** Per-strand node counts for models whose strands are not uniform
     *  (Poly Line: lights per segment, as Model::GetStrandLength reports). */
    strandLengths?: number[];
    /** Poly Line: drop points per segment (PolyLineModel::_polyLineSizes), the
     *  "Line Segments" buffer style's row widths. */
    polyLineSizes?: number[];

    /** Metadata */
    modelType?: string;
    pixelSize?: number;
    pixelStyle?: string;
    pixelType?: string;
    pixelSpacing?: string;
    transparency?: number;
    stringType?: string;

    /** Name of the xLights preview / layout group this model belongs to (from the model's `LayoutGroup` attribute). */
    layoutGroup?: string;

    /** Channel mapping (populated after channel resolution) */
    channelMapping?: ModelChannelMapping;

    /** Per-channel render contribution for one node.  Length matches
     *  channelMapping.channelsPerNode.  Lets a preview consumer convert
     *  raw frame bytes to RGB without re-parsing StringType strings. */
    channelRoles?: ChannelRole[];

    /** Color profile */
    colorProfile?: NodeColorProfile;

    /** Image-specific data (path, off-brightness, etc.).  Set only when
     *  modelType === 'Image'. */
    imageInfo?: ImageInfo;
}

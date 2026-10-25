export { getModelCoordinates, getAllModelCoordinates, AllModelsResult, ModelResult, type MhFixtureInfo, getAllMovingHeads } from '../modelcalcs/modelinterface';
export { type ModelParseOptions } from '../modelcalcs/models';
export { NodeCoord, NodeLoc, GetNodeResult } from '../modelcalcs/modelbase';
export { getAllLayoutGroups, type LayoutGroupInfo } from '../modelcalcs/layoutgroups';
export { getAllViewpoints, type ViewpointInfo, type ViewpointsResult } from '../modelcalcs/viewpoints';
export { getAllViewObjects, type ViewObjectInfo } from '../modelcalcs/viewobjects';
export { getLayoutSettings, type LayoutSettingsInfo } from '../modelcalcs/layoutsettings';
export {
    getControllersAndModelChannels,
    type ControllersAndModelChannels,
    type XlControllerInfo,
    type XlControllerActiveState,
    type XlControllerType,
    type XlControllerOutput,
    type XlControllerConnectionInfo,
    type XlModelChannelInfo,
    type XlNetworkProtocol,
    type XlPixelProtocol,
} from '../modelcalcs/controllers';

// Moving Head types and functions
export {
    type MhMotorDef,
    type MhColorDef,
    type MhColorType,
    type MhColorWheelEntry,
    type MhDimmerDef,
    type MhShutterDef,
    type MhDefinition,
    type MhPresetEntry,
    motorIs16Bit,
    motorMaxValue,
    parseMhDefinition,
    normalizeMhMotorDef, // Fold legacy negative-ROM reverse idiom, swap inverted limits
    mhDefinitionHasMotors, // True for a real MH (has pan/tilt); false for motorless fog/fountain/etc.
} from '../modelcalcs/mhdef';

// Moving Head fixture linter — static sanity checks of a fixture definition
export {
    type MhLintFinding,
    lintMhDefinition,
    formatMhLintFindings,
} from '../modelcalcs/mhlint';

export {
    type MhPhysicalState, // Physical state (direction, light)
    type MhSlewFilter,
    motorGetPosition, // Get position from channels
    mhChannelsToState, // Get state of MH from fseq channels
    createMhSlewFilter, // Slew-limit decoded angles like the xLights preview does
} from '../modelcalcs/mhcalc';

export {
    processMhFrame, // FSEQ Data + MH definition -> MhPhysicalState
} from '../modelcalcs/mhframe';

export {
    type MhBeamParams, // Beam shape (from xl def)
    type MhWorldTransform, // MH -> World coords (from xl def)
    type MhBeamDescriptor, // Result type of computeBeamDescriptor
    computeBeamDescriptor, // key entrypoint to calculate beam position
} from '../modelcalcs/mhbeam';

// Submodels: <subModel> definitions resolved to node subsets + render buffers
export {
    parseSubModelDefs, // <model> element -> SubModelDef[]
    buildSubModel, // (parent GetNodeResult, def) -> nodes in submodel order + buffer size
    describeSubModel, // one-line summary for reports
    type SubModelDef,
    type SubModelNode,
    type SubModelCoord,
    type SubModelResult,
} from '../modelcalcs/submodel';

// XML format migration (fork ↔ upstream)
export {
    identifyFileType, // Quick check: 'rgbeffects' | 'networks' | 'unknown'
    identifyXml, // Full identification with format + signals
    migrateToFormat, // Idempotent: detect current format, convert to target
    migrateRgbEffects, // Directional: explicit forward/backward
    normalizeModelElementForward, // Per-<model> in-place normalization to x2026_3 form (idempotent)
    filterViewObjectsForFormat, // Drop <view_object>s the target version can't load
    VIEW_OBJECT_ALLOW_LIST, // view_object DisplayAs values per TargetFormat
    type XlFileType,
    type XlFormat,
    type XlFileIdentification,
    type TargetFormat,
    type MigrationDirection,
    type MigrationResult,
    type EffectPresetsJson,
    PARM_RENAMES,
    getBaseDisplayAs, // "Tree 360" -> "Tree", "Vert Matrix" -> "Matrix", "DmxFloodlight" -> "Dmx", ...
} from '../modelcalcs/xmlmigrate';

// World-placement transforms (move / rotate / scale a whole layout)
export {
    transformLayoutPlacement, // Apply an affine matrix to every model + view object placement
    transformPlacementElement, // Same, for one <model> / <view_object>
    placementKindOf, // 'boxed' | 'two-point' | 'three-point' | 'poly'
    composeTransform, // translate / rotate / scale steps -> matrix
    boxedWorldMatrix, // T * Rz * Ry * Rx * S for a boxed placement
    decomposeBoxed, // matrix -> position / scale / RotateX/Y/Z
    eulerFromRotation,
    mat4Identity,
    mat4Multiply,
    mat4Translation,
    mat4Scaling,
    mat4RotationX,
    mat4RotationY,
    mat4RotationZ,
    mat4RotationAxis,
    mat4TransformPoint,
    mat4TransformVector,
    type Mat4,
    type Vec3,
    type TransformStep,
    type PlacementKind,
    type BoxedPlacement,
    type BoxedDecomposition,
    type PlacementTransformOptions,
    type PlacementTransformResult,
} from '../modelcalcs/placement';

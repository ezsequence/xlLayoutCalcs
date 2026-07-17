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
    type XlModelChannelInfo,
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
    motorIs16Bit,
    motorMaxValue,
    parseMhDefinition,
} from '../modelcalcs/mhdef';

export {
    type MhPhysicalState, // Physical state (direction, light)
    motorGetPosition, // Get position from channels
    mhChannelsToState, // Get state of MH from fseq channels
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

// XML format migration (fork ↔ upstream)
export {
    identifyFileType, // Quick check: 'rgbeffects' | 'networks' | 'unknown'
    identifyXml, // Full identification with format + signals
    migrateToFormat, // Idempotent: detect current format, convert to target
    migrateRgbEffects, // Directional: explicit forward/backward
    normalizeModelElementForward, // Per-<model> in-place normalization to x2026_3 form (idempotent)
    type XlFileType,
    type XlFormat,
    type XlFileIdentification,
    type TargetFormat,
    type MigrationDirection,
    type MigrationResult,
    type EffectPresetsJson,
    PARM_RENAMES,
} from '../modelcalcs/xmlmigrate';

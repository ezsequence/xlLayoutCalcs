import {
    NodeCoord,
    NodeLoc,
    EffectBufferDescriptionInput,
    ModelProperty,
    ModelType,
    GetNodeResult,
} from "./modelbase";
import { defEffectBufferDescriptionOutput } from "./modelshared";
import { defNodeCoord } from "./modelshared";
import { defNodeLoc } from "./modelshared";
import { getWorldMatrixForBoxed } from "./modelshared";
import { BaseModelClass } from "./modelshared";
import { MhDefinition } from "./mhdef";

const dmxProperties: ModelProperty[] = [
    {name: 'DmxChannelCount', ptype: "INTEGER", fieldName: 'numChannels', xmlName: 'DmxChannelCount', description: "# Channels"},
    {name: 'parm2', ptype: "INTEGER", fieldName: 'parm2', xmlName: 'parm2', description: "Parameter 2"},
    {name: 'parm3', ptype: "INTEGER", fieldName: 'parm3', xmlName: 'parm3', description: "Parameter 3"},
    {name: 'DmxStyle', ptype: "STRING", fieldName: 'dmxStyle', xmlName: 'DmxStyle', description: "DMX Style"},
    {name: 'DmxFixture', ptype: "STRING", fieldName: 'dmxFixture', xmlName: 'DmxFixture', description: "DMX Fixture"},
    // Color channels
    {name: 'DmxRedChannel', ptype: "INTEGER", fieldName: 'dmxRedChannel', xmlName: 'DmxRedChannel', description: "Red Channel"},
    {name: 'DmxGreenChannel', ptype: "INTEGER", fieldName: 'dmxGreenChannel', xmlName: 'DmxGreenChannel', description: "Green Channel"},
    {name: 'DmxBlueChannel', ptype: "INTEGER", fieldName: 'dmxBlueChannel', xmlName: 'DmxBlueChannel', description: "Blue Channel"},
    {name: 'DmxWhiteChannel', ptype: "INTEGER", fieldName: 'dmxWhiteChannel', xmlName: 'DmxWhiteChannel', description: "White Channel"},
    // Shutter
    {name: 'DmxShutterChannel', ptype: "INTEGER", fieldName: 'dmxShutterChannel', xmlName: 'DmxShutterChannel', description: "Shutter Channel"},
    {name: 'DmxShutterOpen', ptype: "INTEGER", fieldName: 'dmxShutterOpen', xmlName: 'DmxShutterOpen', description: "Shutter Open Value"},
    {name: 'DmxShutterOnValue', ptype: "INTEGER", fieldName: 'dmxShutterOnValue', xmlName: 'DmxShutterOnValue', description: "Shutter On Value"},
    // Beam parameters
    {name: 'DmxBeamLimit', ptype: "FLOAT", fieldName: 'dmxBeamLimit', xmlName: 'DmxBeamLimit', description: "Beam Limit"},
    {name: 'DmxBeamWidth', ptype: "FLOAT", fieldName: 'dmxBeamWidth', xmlName: 'DmxBeamWidth', description: "Beam Width"},
    {name: 'DmxBeamLength', ptype: "FLOAT", fieldName: 'dmxBeamLength', xmlName: 'DmxBeamLength', description: "Beam Length"},
    {name: 'DmxBeamYOffset', ptype: "FLOAT", fieldName: 'dmxBeamYOffset', xmlName: 'DmxBeamYOffset', description: "Beam Y Offset"},
    {name: 'DmxBeamOrient', ptype: "FLOAT", fieldName: 'dmxBeamOrient', xmlName: 'DmxBeamOrient', description: "Beam Orientation"},
    // Pan/tilt motor channels (used by older DmxMovingHead; DmxMovingHeadAdv uses mhDefinition)
    {name: 'DmxPanChannel', ptype: "INTEGER", fieldName: 'dmxPanChannel', xmlName: 'DmxPanChannel', description: "Pan Channel"},
    {name: 'DmxPanOrient', ptype: "INTEGER", fieldName: 'dmxPanOrient', xmlName: 'DmxPanOrient', description: "Pan Orient"},
    {name: 'DmxPanDegOfRot', ptype: "INTEGER", fieldName: 'dmxPanDegOfRot', xmlName: 'DmxPanDegOfRot', description: "Pan Degrees of Rotation"},
    {name: 'DmxPanSlewLimit', ptype: "FLOAT", fieldName: 'dmxPanSlewLimit', xmlName: 'DmxPanSlewLimit', description: "Pan Slew Limit"},
    {name: 'DmxTiltChannel', ptype: "INTEGER", fieldName: 'dmxTiltChannel', xmlName: 'DmxTiltChannel', description: "Tilt Channel"},
    {name: 'DmxTiltOrient', ptype: "INTEGER", fieldName: 'dmxTiltOrient', xmlName: 'DmxTiltOrient', description: "Tilt Orient"},
    {name: 'DmxTiltDegOfRot', ptype: "INTEGER", fieldName: 'dmxTiltDegOfRot', xmlName: 'DmxTiltDegOfRot', description: "Tilt Degrees of Rotation"},
    {name: 'DmxTiltSlewLimit', ptype: "FLOAT", fieldName: 'dmxTiltSlewLimit', xmlName: 'DmxTiltSlewLimit', description: "Tilt Slew Limit"},
    // CMY color channels
    {name: 'DmxCyanChannel', ptype: "INTEGER", fieldName: 'dmxCyanChannel', xmlName: 'DmxCyanChannel', description: "Cyan Channel"},
    {name: 'DmxMagentaChannel', ptype: "INTEGER", fieldName: 'dmxMagentaChannel', xmlName: 'DmxMagentaChannel', description: "Magenta Channel"},
    {name: 'DmxYellowChannel', ptype: "INTEGER", fieldName: 'dmxYellowChannel', xmlName: 'DmxYellowChannel', description: "Yellow Channel"},
    // Display
    {name: 'HideBody', ptype: "BOOL", fieldName: 'hideBody', xmlName: 'HideBody', description: "Hide Body in preview"},
    // Dimmer
    {name: 'DmxDimmerChannel', ptype: "INTEGER", fieldName: 'dmxDimmerChannel', xmlName: 'DmxDimmerChannel', description: "Dimmer Channel"},
    {name: 'MhDimmerChannel', ptype: "INTEGER", fieldName: 'mhDimmerChannel', xmlName: 'MhDimmerChannel', description: "MH Dimmer Channel"},
    // Color wheel
    {name: 'DmxColorType', ptype: "STRING", fieldName: 'dmxColorType', xmlName: 'DmxColorType', description: "Color Type"},
    {name: 'DmxColorWheelChannel', ptype: "INTEGER", fieldName: 'dmxColorWheelChannel', xmlName: 'DmxColorWheelChannel', description: "Color Wheel Channel"},
    {name: 'DmxColorWheelDelay', ptype: "INTEGER", fieldName: 'dmxColorWheelDelay', xmlName: 'DmxColorWheelDelay', description: "Color Wheel Delay"},
    // Note: DmxColorWheelColor0-13 and DmxColorWheelDMX0-13 are dynamic properties parsed separately
];

export class DmxModel extends BaseModelClass {
    modelType: ModelType = DmxModelType;
    numChannels: number = 1;
    parm2: number = 0;
    parm3: number = 0;
    dmxStyle: string = "";
    dmxFixture: string = "";
    lightsPerNode: number = 1;
    singleNode: boolean = true;  // DMX channels are single-color nodes

    // Color channels
    dmxRedChannel: number = 0;
    dmxGreenChannel: number = 0;
    dmxBlueChannel: number = 0;
    dmxWhiteChannel: number = 0;

    // Shutter
    dmxShutterChannel: number = 0;
    dmxShutterOpen: number = 1;  // xLights default: shutter open when value >= 1
    dmxShutterOnValue: number = 0;

    // Beam parameters
    dmxBeamLimit: number = 0;
    dmxBeamWidth: number = 0;
    dmxBeamLength: number = 0;
    dmxBeamYOffset: number = 0;
    dmxBeamOrient: number = 0;

    // Pan/tilt motor channels
    dmxPanChannel: number = 0;
    dmxPanOrient: number = 0;
    dmxPanDegOfRot: number = 0;
    dmxPanSlewLimit: number = 0;
    dmxTiltChannel: number = 0;
    dmxTiltOrient: number = 0;
    dmxTiltDegOfRot: number = 0;
    dmxTiltSlewLimit: number = 0;

    // CMY color channels
    dmxCyanChannel: number = 0;
    dmxMagentaChannel: number = 0;
    dmxYellowChannel: number = 0;

    // Display
    hideBody: boolean = false;

    // Dimmer
    dmxDimmerChannel: number = 0;
    mhDimmerChannel: number = 0;

    // Color wheel
    dmxColorType: string = "";
    dmxColorWheelChannel: number = 0;
    dmxColorWheelDelay: number = 0;

    // Dynamic color wheel entries (DmxColorWheelColor0-13, DmxColorWheelDMX0-13)
    // Key is index (0-13), value is color string or DMX value
    colorWheelColors: Map<number, string> = new Map();
    colorWheelDMX: Map<number, number> = new Map();

    // Controlling mesh dimensions for beam length scaling (xLights GetRenderWi/Ht/Dp).
    // DmxMovingHead always uses 1,1,1. DmxMovingHeadAdv reads from HeadMesh/YokeMesh/BaseMesh.
    meshWidth: number = 1;
    meshHeight: number = 1;
    meshDepth: number = 1;

    // Moving head definition (populated for DmxMovingHead/DmxMovingHeadAdv)
    mhDefinition?: MhDefinition;

    constructor() {super();}

    getType(): string {
        return "DMX";
    }

    getProperties(): ModelProperty[] {
        return dmxProperties;
    }

    getNumNodes() {
        return this.numChannels;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];
        let logicalBufferWidth = 1, logicalBufferHeight = 1, logicalBufferDepth = 1;

        const nodeCount = this.getNumNodes();

        // Create nodes - each DMX channel is a single node
        for (let i = 0; i < nodeCount; ++i) {
            const nn = defNodeLoc();
            nn.coords.push(defNodeCoord());
            nodes.push(nn);
        }

        logicalBufferHeight = 1;
        logicalBufferWidth = nodeCount;

        // Assign coordinates
        // Buffer: single row, one column per channel
        // Screen: C++ uses -0.5,-0.5 and 0.5,0.5 for first two nodes to create selection area
        for (let x = 0; x < nodeCount; x++) {
            nodes[x].physicalNum = x;
            nodes[x].physicalStrand = 0;
            nodes[x].physicalNumOnStrand = x;
            nodes[x].logicalNum = x;

            nodes[x].coords[0].bufX = 0;  // C++ sets all bufX/bufY to 0
            nodes[x].coords[0].bufY = 0;

            // Screen coordinates: first two nodes define bounding box, rest at center
            if (x === 0) {
                nodes[x].coords[0].modelX = -0.5;
                nodes[x].coords[0].modelY = -0.5;
            } else if (x === 1) {
                nodes[x].coords[0].modelX = 0.5;
                nodes[x].coords[0].modelY = 0.5;
            } else {
                nodes[x].coords[0].modelX = 0;
                nodes[x].coords[0].modelY = 0;
            }

            nodes[x].logicalX = nodes[x].coords[0].bufX;
            nodes[x].logicalY = nodes[x].coords[0].bufY;
        }

        // Use boxed screen location like C++
        const toWorldCoords = getWorldMatrixForBoxed(this);

        return {
            toWorldCoords,
            toWorld2DCoords: toWorldCoords,
            logicalBufferWidth,
            logicalBufferHeight,
            logicalBufferDepth,
            nodes,
        };
    }

    getBufferDescription(ind: EffectBufferDescriptionInput) {
        const ebdo = defEffectBufferDescriptionOutput();
        return ebdo;
    }
}

export const DmxModelType: ModelType = {
    typeName: "DMX",
    displayAs: "DMX",
    modelXmlTag: 'dmxmodel',
};

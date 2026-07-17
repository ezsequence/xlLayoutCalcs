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
import { getWorldMatrixFor2Pt } from "./modelshared";
import { BaseModelClass } from "./modelshared";

const channelBlockProperties: ModelProperty[] = [
    {name: 'ChannelBlockCount', ptype: "INTEGER", fieldName: 'numChannels', xmlName: 'NumChannels', description: "# Channels"},
    {name: 'parm2', ptype: "INTEGER", fieldName: 'parm2', xmlName: 'parm2', description: "Parameter 2"},
    {name: 'parm3', ptype: "INTEGER", fieldName: 'parm3', xmlName: 'parm3', description: "Parameter 3"},
];

export class ChannelBlockModel extends BaseModelClass {
    modelType: ModelType = ChannelBlockModelType;
    numChannels: number = 1;
    parm2: number = 0;
    parm3: number = 0;
    lightsPerNode: number = 1;
    singleNode: boolean = true;  // Channel block always uses single node per channel

    constructor() {super();}

    getType(): string {
        return "ChannelBlock";
    }

    getProperties(): ModelProperty[] {
        return channelBlockProperties;
    }

    getNumNodes() {
        return this.numChannels;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];
        let logicalBufferWidth = 1, logicalBufferHeight = 1, logicalBufferDepth = 1;

        const nodeCount = this.getNumNodes();

        // Create nodes - each channel is a single node
        for (let i = 0; i < nodeCount; ++i) {
            const nn = defNodeLoc();
            nn.coords.push(defNodeCoord());
            nodes.push(nn);
        }

        logicalBufferHeight = 1;
        logicalBufferWidth = nodeCount;

        // Assign coordinates
        // Buffer: single row, one column per channel
        // Screen: spread across X, Y = 0
        for (let x = 0; x < nodeCount; x++) {
            nodes[x].physicalNum = x;
            nodes[x].physicalStrand = x;
            nodes[x].physicalNumOnStrand = 0;
            nodes[x].logicalNum = x;

            nodes[x].coords[0].bufX = x;
            nodes[x].coords[0].bufY = 0;

            // Screen coordinates: spread nodes across X axis
            // C++ uses offset of 0.5 for centering within each cell
            const num = 1;  // Single coord per node
            const offset = 0.5;
            nodes[x].coords[0].modelX = x + offset;
            nodes[x].coords[0].modelY = 0;

            nodes[x].logicalX = nodes[x].coords[0].bufX;
            nodes[x].logicalY = nodes[x].coords[0].bufY;
        }

        // Scale factor for world transformation. Single Line passes 1/BufferWi
        // for the same reason: modelX ranges across the buffer (0.5..N-0.5)
        // and the 2-point world matrix scales by segment length × scaleX, so
        // we divide by N to map the full segment length onto the buffer span.
        const scaleX = nodeCount > 0 ? 1 / nodeCount : 1;
        const toWorldCoords = getWorldMatrixFor2Pt(this, scaleX);

        return {
            toWorldCoords,
            toWorld2DCoords: toWorldCoords, // 2D model, no perspective needed
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

export const ChannelBlockModelType: ModelType = {
    typeName: "Channel Block",
    displayAs: "Channel Block",
    modelXmlTag: 'channelblockmodel',
};

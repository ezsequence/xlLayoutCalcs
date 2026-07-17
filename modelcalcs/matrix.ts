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
import { BaseModelClass, ModelChannelInfo } from "./modelshared";

const matrixProperties: ModelProperty[] = [
    {name: 'MatrixStringCount', ptype: "INTEGER", fieldName: 'numStrings', xmlName: 'NumStrings', description: "# Strings"},
    {name: 'MatrixLightCount', ptype: "INTEGER", fieldName: 'pixelsPerString', xmlName: 'NodesPerString', description: "Nodes Per String"},
    {name: 'MatrixStrandCount', ptype: "INTEGER", fieldName: 'strandsPerString', xmlName: 'StrandsPerString', description: "Strands Per String"},
    {name: 'Vertical', ptype: "BOOL", fieldName: 'vMatrix', xmlName: 'Vertical', description: "Vertical Matrix"},
    {name: 'AlternateNodes', ptype: "BOOL", fieldName: 'alternateNodes', xmlName: 'AlternateNodes', description: "Alternate Nodes"},
    {name: 'NoZig', ptype: "BOOL", fieldName: 'noZig', xmlName: 'NoZig', description: "Don't Zig Zag"},
    {name: 'Dir', ptype: "STRING", fieldName: 'dir', xmlName: 'Dir', description: "Direction L/R"},
    {name: 'StartSide', ptype: "STRING", fieldName: 'startSide', xmlName: 'StartSide', description: "Start Side T/B"},
];

export class MatrixModel extends BaseModelClass {
    modelType: ModelType = MatrixModelType;
    numStrings: number = 1;
    pixelsPerString: number = 50;
    strandsPerString: number = 1;
    lightsPerNode: number = 1;
    singleNode: boolean = false;
    alternateNodes: boolean = false;
    noZig: boolean = false;
    dir: string = "L";
    startSide: string = "T";
    vMatrix: boolean = false; // true = vertical, false = horizontal (absent Vertical attr ⇒ horizontal, matching upstream)

    constructor() {super();}

    getType(): string {
        return "Matrix";
    }

    getProperties(): ModelProperty[] {
        return matrixProperties;
    }

    getNumNodes() {
        if (this.singleNode) {
            return this.numStrings;  // One node per string in single node mode
        }
        // Note: For display, we truncate to evenly divisible by strandsPerString
        // But getNumNodes returns what's used for display, not channels
        let strandsPerString = this.strandsPerString;
        if (strandsPerString > this.pixelsPerString) {
            strandsPerString = this.pixelsPerString;
        }
        const pixelsPerStrand = Math.floor(this.pixelsPerString / strandsPerString);
        const displayPixelsPerString = pixelsPerStrand * strandsPerString;
        return this.numStrings * displayPixelsPerString;
    }

    getChannelInfo(): ModelChannelInfo {
        // For channel allocation, xLights uses the ORIGINAL pixelsPerString (parm2)
        // even if it doesn't divide evenly by strandsPerString.
        // This ensures channel spacing matches the C++ behavior.
        const nodesPerString: number[] = [];

        if (this.singleNode) {
            // Single node mode: one node per string
            for (let i = 0; i < this.numStrings; i++) {
                nodesPerString.push(1);
            }
        } else {
            // Use original pixelsPerString for channel allocation
            for (let i = 0; i < this.numStrings; i++) {
                nodesPerString.push(this.pixelsPerString);
            }
        }

        return {
            name: this.name,
            startChannel: this.startChannel || '1',
            stringType: this.stringType || 'RGB Nodes',
            numStrings: this.numStrings,
            nodesPerString,
            advanced: this.advanced,
            stringStartChannels: this.stringStartChannels,
            superStringColourCount: this.superStringColours.size,
        };
    }

    initVMatrix(): GetNodeResult {
        const nodes: NodeLoc[] = [];

        let strandsPerString = this.strandsPerString;
        if (strandsPerString > this.pixelsPerString) {
            strandsPerString = this.pixelsPerString;
        }

        const numStrands = this.numStrings * strandsPerString;
        const pixelsPerStrand = Math.floor(this.pixelsPerString / strandsPerString);
        const pixelsPerString = pixelsPerStrand * strandsPerString;

        const isLtoR = this.dir === 'L';
        const isBotToTop = this.startSide === 'B';

        if (this.singleNode) {
            // Single node mode: one node per string, all lights as coords
            // Buffer collapses to 1 × numStrings, all coords at same position
            const nodeCount = this.numStrings;
            const logicalBufferWidth = 1;
            const logicalBufferHeight = nodeCount;

            for (let n = 0; n < nodeCount; n++) {
                const nn = defNodeLoc();
                nn.physicalNum = n;
                nn.physicalStrand = n;
                nn.physicalNumOnStrand = 0;
                nn.logicalNum = n;
                nn.logicalX = 0;
                nn.logicalY = n;

                // Create coords for all lights on this string - all at same buffer position
                for (let c = 0; c < pixelsPerString; c++) {
                    const coord = defNodeCoord();
                    coord.bufX = 0;
                    coord.bufY = n;

                    // Model coordinates based on original matrix position
                    // Vertical matrix: X = string index, Y = position along string
                    // Use same centering as normal mode (C++ shifts coords but we don't replicate that)
                    const origBufX = isLtoR ? n : numStrands - n - 1;
                    const origBufY = isBotToTop ? c : pixelsPerStrand - c - 1;
                    coord.modelX = origBufX - Math.floor(numStrands / 2);
                    coord.modelY = origBufY - Math.floor(pixelsPerStrand / 2);

                    nn.coords.push(coord);
                }
                nodes.push(nn);
            }

            const toWorldCoords = getWorldMatrixForBoxed(this);

            return {
                toWorldCoords,
                toWorld2DCoords: toWorldCoords,
                logicalBufferWidth,
                logicalBufferHeight,
                logicalBufferDepth: 1,
                nodes,
            };
        }

        // Normal mode
        const nodeCount = this.numStrings * pixelsPerString;
        const logicalBufferWidth = numStrands;
        const logicalBufferHeight = pixelsPerStrand;

        // Create nodes
        for (let i = 0; i < nodeCount; ++i) {
            const nn = defNodeLoc();
            nn.coords.push(defNodeCoord());
            nodes.push(nn);
        }

        // Assign coordinates for vertical matrix
        for (let x = 0; x < numStrands; x++) {
            const stringnum = Math.floor(x / strandsPerString);
            const segmentnum = x % strandsPerString;

            for (let y = 0; y < pixelsPerStrand; y++) {
                const idx = stringnum * pixelsPerString + segmentnum * pixelsPerStrand + y;
                if (idx >= nodeCount) continue;

                // physicalNum uses original this.pixelsPerString for channel alignment
                // (xLights allocates channels based on parm2 even if not evenly divisible)
                nodes[idx].physicalNum = stringnum * this.pixelsPerString + segmentnum * pixelsPerStrand + y;
                nodes[idx].physicalStrand = stringnum;
                nodes[idx].physicalNumOnStrand = segmentnum * pixelsPerStrand + y;
                nodes[idx].logicalNum = idx;

                nodes[idx].coords[0].bufX = isLtoR ? x : numStrands - x - 1;

                if (this.alternateNodes) {
                    if (isBotToTop) {
                        if (y + 1 <= Math.floor((pixelsPerStrand + 1) / 2)) {
                            nodes[idx].coords[0].bufY = y * 2;
                        } else {
                            nodes[idx].coords[0].bufY = (pixelsPerStrand - (y + 1)) * 2 + 1;
                        }
                    } else {
                        if (y + 1 <= Math.floor((pixelsPerStrand + 1) / 2)) {
                            nodes[idx].coords[0].bufY = (pixelsPerStrand - 1) - (y * 2);
                        } else {
                            nodes[idx].coords[0].bufY = (pixelsPerStrand - 1) - ((pixelsPerStrand - (y + 1)) * 2 + 1);
                        }
                    }
                } else {
                    if (this.noZig) {
                        nodes[idx].coords[0].bufY = isBotToTop ? y : pixelsPerStrand - y - 1;
                    } else {
                        nodes[idx].coords[0].bufY = (isBotToTop === (segmentnum % 2 === 0)) ? y : pixelsPerStrand - y - 1;
                    }
                }

                // Set model coordinates (centered) - use integer division to match C++
                nodes[idx].coords[0].modelX = nodes[idx].coords[0].bufX - Math.floor(numStrands / 2);
                nodes[idx].coords[0].modelY = nodes[idx].coords[0].bufY - Math.floor(pixelsPerStrand / 2);

                nodes[idx].logicalX = nodes[idx].coords[0].bufX;
                nodes[idx].logicalY = nodes[idx].coords[0].bufY;
            }
        }

        const toWorldCoords = getWorldMatrixForBoxed(this);

        return {
            toWorldCoords,
            toWorld2DCoords: toWorldCoords, // 2D model, no perspective needed
            logicalBufferWidth,
            logicalBufferHeight,
            logicalBufferDepth: 1,
            nodes,
        };
    }

    initHMatrix(): GetNodeResult {
        const nodes: NodeLoc[] = [];

        let strandsPerString = this.strandsPerString;
        if (strandsPerString > this.pixelsPerString) {
            strandsPerString = this.pixelsPerString;
        }

        const numStrands = this.numStrings * strandsPerString;
        const pixelsPerStrand = Math.floor(this.pixelsPerString / strandsPerString);
        const pixelsPerString = pixelsPerStrand * strandsPerString;

        const isLtoR = this.dir === 'L';
        const isBotToTop = this.startSide === 'B';

        if (this.singleNode) {
            // Single node mode: one node per string, all lights as coords
            // Buffer collapses to 1 × numStrings, all coords at same position
            const nodeCount = this.numStrings;
            const logicalBufferWidth = 1;
            const logicalBufferHeight = nodeCount;

            for (let n = 0; n < nodeCount; n++) {
                const nn = defNodeLoc();
                nn.physicalNum = n;
                nn.physicalStrand = n;
                nn.physicalNumOnStrand = 0;
                nn.logicalNum = n;
                nn.logicalX = 0;
                nn.logicalY = n;

                // Create coords for all lights on this string - all at same buffer position
                for (let c = 0; c < pixelsPerString; c++) {
                    const coord = defNodeCoord();
                    coord.bufX = 0;
                    coord.bufY = n;

                    // Model coordinates based on original matrix position
                    // Horizontal matrix: X = position along string, Y = string index
                    // Use same centering as normal mode (C++ shifts coords but we don't replicate that)
                    const origBufX = isLtoR ? c : pixelsPerStrand - c - 1;
                    const origBufY = isBotToTop ? n : numStrands - n - 1;
                    coord.modelX = origBufX - Math.floor(pixelsPerStrand / 2);
                    coord.modelY = origBufY - Math.floor(numStrands / 2);

                    nn.coords.push(coord);
                }
                nodes.push(nn);
            }

            const toWorldCoords = getWorldMatrixForBoxed(this);

            return {
                toWorldCoords,
                toWorld2DCoords: toWorldCoords,
                logicalBufferWidth,
                logicalBufferHeight,
                logicalBufferDepth: 1,
                nodes,
            };
        }

        // Normal mode
        const nodeCount = this.numStrings * pixelsPerString;
        const logicalBufferWidth = pixelsPerStrand;
        const logicalBufferHeight = numStrands;

        // Create nodes
        for (let i = 0; i < nodeCount; ++i) {
            const nn = defNodeLoc();
            nn.coords.push(defNodeCoord());
            nodes.push(nn);
        }

        // Assign coordinates for horizontal matrix
        for (let y = 0; y < numStrands; y++) {
            const stringnum = Math.floor(y / strandsPerString);
            const segmentnum = y % strandsPerString;

            for (let x = 0; x < pixelsPerStrand; x++) {
                const idx = stringnum * pixelsPerString + segmentnum * pixelsPerStrand + x;
                if (idx >= nodeCount) continue;

                // physicalNum uses original this.pixelsPerString for channel alignment
                // (xLights allocates channels based on parm2 even if not evenly divisible)
                nodes[idx].physicalNum = stringnum * this.pixelsPerString + segmentnum * pixelsPerStrand + x;
                nodes[idx].physicalStrand = stringnum;
                nodes[idx].physicalNumOnStrand = segmentnum * pixelsPerStrand + x;
                nodes[idx].logicalNum = idx;

                nodes[idx].coords[0].bufY = isBotToTop ? y : numStrands - y - 1;

                if (this.alternateNodes) {
                    if (isLtoR) {
                        if (x + 1 <= Math.floor((pixelsPerStrand + 1) / 2)) {
                            nodes[idx].coords[0].bufX = x * 2;
                        } else {
                            nodes[idx].coords[0].bufX = (pixelsPerStrand - (x + 1)) * 2 + 1;
                        }
                    } else {
                        if (x + 1 <= Math.floor((pixelsPerStrand + 1) / 2)) {
                            nodes[idx].coords[0].bufX = (pixelsPerStrand - 1) - (x * 2);
                        } else {
                            nodes[idx].coords[0].bufX = (pixelsPerStrand - 1) - ((pixelsPerStrand - (x + 1)) * 2 + 1);
                        }
                    }
                } else {
                    if (this.noZig) {
                        nodes[idx].coords[0].bufX = !isLtoR ? pixelsPerStrand - x - 1 : x;
                    } else {
                        nodes[idx].coords[0].bufX = (isLtoR !== (segmentnum % 2 === 0)) ? pixelsPerStrand - x - 1 : x;
                    }
                }

                // Set model coordinates (centered) - use integer division to match C++
                nodes[idx].coords[0].modelX = nodes[idx].coords[0].bufX - Math.floor(pixelsPerStrand / 2);
                nodes[idx].coords[0].modelY = nodes[idx].coords[0].bufY - Math.floor(numStrands / 2);

                nodes[idx].logicalX = nodes[idx].coords[0].bufX;
                nodes[idx].logicalY = nodes[idx].coords[0].bufY;
            }
        }

        const toWorldCoords = getWorldMatrixForBoxed(this);

        return {
            toWorldCoords,
            toWorld2DCoords: toWorldCoords, // 2D model, no perspective needed
            logicalBufferWidth,
            logicalBufferHeight,
            logicalBufferDepth: 1,
            nodes,
        };
    }

    getNodeCoords(): GetNodeResult {
        if (this.vMatrix) {
            return this.initVMatrix();
        } else {
            return this.initHMatrix();
        }
    }

    getBufferDescription(ind: EffectBufferDescriptionInput) {
        const ebdo = defEffectBufferDescriptionOutput();
        return ebdo;
    }
}

export const MatrixModelType: ModelType = {
    typeName: "Matrix",
    displayAs: "Horiz Matrix",
    modelXmlTag: 'matrixmodel',
};

export const VertMatrixModelType: ModelType = {
    typeName: "Vert Matrix",
    displayAs: "Vert Matrix",
    modelXmlTag: 'matrixmodel',
};

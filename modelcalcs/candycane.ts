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
import { getWorldMatrixFor3Pt } from "./modelshared";
import { BaseModelClass } from "./modelshared";

import { rotatePoint, toRadians } from "./utils";

const candyCaneProperties: ModelProperty[] = [
    {name: 'CandyCaneCount', ptype: "INTEGER", fieldName: 'numCanes', xmlName: 'NumCanes', description: "# Canes"},
    {name: 'CandyCaneNodes', ptype: "INTEGER", fieldName: 'segmentsPerCane', xmlName: 'NodesPerCane', description: "Nodes Per Cane"},
    {name: 'CandyCaneLights', ptype: "INTEGER", fieldName: 'lightsPerNode', xmlName: 'LightsPerNode', description: "Lights Per Node"},
    {name: 'SingleNode', ptype: "BOOL", fieldName: 'singleNode', xmlName: 'SingleNode', description: "Single Node - for dumb strings"},
    {name: 'CandyCaneHeight', ptype: "FLOAT", fieldName: 'caneHeight', xmlName: 'CandyCaneHeight', description: "Cane Height Mult"},
    {name: 'CandyCaneReverse', ptype: "BOOL", fieldName: 'reverse', xmlName: 'CandyCaneReverse', description: "Reverse"},
    {name: 'CandyCaneSticks', ptype: "BOOL", fieldName: 'sticks', xmlName: 'CandyCaneSticks', description: "Sticks"},
    {name: 'AlternateNodes', ptype: "BOOL", fieldName: 'alternateNodes', xmlName: 'AlternateNodes', description: "Alternate Nodes"},
    {name: 'Angle', ptype: "FLOAT", fieldName: 'angle', xmlName: 'Angle', description: "Cane Rotation"},
    {name: 'Dir', ptype: "STRING", fieldName: 'dir', xmlName: 'Dir', description: "Direction L/R"},
    {name: 'StartSide', ptype: "STRING", fieldName: 'startSide', xmlName: 'StartSide', description: "Start Side T/B"},
    {name: 'Height', ptype: "FLOAT", fieldName: 'height', xmlName: 'Height', description: "Height scaling"},
];

export class CandyCaneModel extends BaseModelClass {
    modelType: ModelType = CandyCaneModelType;
    numCanes: number = 1;
    segmentsPerCane: number = 12;
    lightsPerNode: number = 1;
    singleNode: boolean = false;
    caneHeight: number = 1.0;
    reverse: boolean = false;
    sticks: boolean = false;
    alternateNodes: boolean = false;
    angle: number = 0;
    dir: string = "L";
    startSide: string = "B";
    height: number = 1.0;

    constructor() {super();}

    getType(): string {
        return "CandyCane";
    }

    getProperties(): ModelProperty[] {
        return candyCaneProperties;
    }

    getNumNodes() {
        if (this.singleNode) {
            return this.numCanes;  // One node per cane in single node mode
        }
        return this.numCanes * this.segmentsPerCane;
    }

    // Each cane is one physical string (mirrors xLights CandyCaneModel,
    // where parm1 = number of canes = number of strings).
    getNumPhysicalStrings(): number {
        return this.numCanes;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];
        let logicalBufferWidth = 1, logicalBufferHeight = 1, logicalBufferDepth = 1;

        const numCanes = this.numCanes;
        const originalSegmentsPerCane = this.segmentsPerCane;
        let segmentsPerCane = this.segmentsPerCane;
        let lightsPerNode = this.lightsPerNode;

        if (this.singleNode) {
            let perCane = originalSegmentsPerCane;
            if (perCane <= 1 && this.lightsPerNode > 1) {
                perCane = this.lightsPerNode;
            }
            lightsPerNode = perCane;
            segmentsPerCane = 1;
        }

        const nodeCount = this.singleNode ? numCanes : numCanes * segmentsPerCane;

        // Create nodes
        for (let i = 0; i < nodeCount; ++i) {
            const nn = defNodeLoc();
            for (let c = 0; c < lightsPerNode; ++c) {
                nn.coords.push(defNodeCoord());
            }
            nodes.push(nn);
        }

        // In single node mode, buffer height is 1 (all coords at same position - single color)
        // In normal mode, buffer height is segmentsPerCane
        logicalBufferHeight = this.singleNode ? 1 : segmentsPerCane;
        logicalBufferWidth = numCanes;

        // Assign buffer coordinates
        // Note: In C++, bufX is simply the cane number (y), not affected by IsLtoR or reverse
        if (this.singleNode) {
            // Single node mode: one node per cane, all coords at same buffer position
            // (single color means all lights in a string have same color)
            for (let cane = 0; cane < numCanes; cane++) {
                const idx = cane;
                if (idx >= nodeCount) continue;

                // For channel assignment: Dir="R" means rightmost cane gets first channels
                const physCaneForChannel = (this.dir === 'R') ? (numCanes - 1 - cane) : cane;

                nodes[idx].physicalNum = physCaneForChannel;
                nodes[idx].physicalStrand = cane;
                nodes[idx].physicalNumOnStrand = 0;
                nodes[idx].logicalNum = idx;

                const coordCount = nodes[idx].coords.length;
                for (let c = 0; c < coordCount; c++) {
                    nodes[idx].coords[c].bufX = cane;
                    nodes[idx].coords[c].bufY = 0;  // All coords at same Y for single color
                }

                nodes[idx].logicalX = nodes[idx].coords[0].bufX;
                nodes[idx].logicalY = nodes[idx].coords[0].bufY;
            }
        } else {
            // Normal mode: multiple nodes per cane
            for (let y = 0; y < numCanes; y++) {
                for (let x = 0; x < segmentsPerCane; x++) {
                    const idx = y * segmentsPerCane + x;
                    if (idx >= nodeCount) continue;

                    // For channel assignment: Dir="R" means:
                    // - Rightmost cane gets first channels
                    // - Within each cane, top/end position is physical pixel 0
                    const physCaneForChannel = (this.dir === 'R') ? (numCanes - 1 - y) : y;
                    const physPosInCane = x;

                    nodes[idx].physicalNum = physCaneForChannel * segmentsPerCane + physPosInCane;
                    nodes[idx].physicalStrand = y;
                    nodes[idx].physicalNumOnStrand = x;
                    nodes[idx].logicalNum = idx;

                    const coordCount = nodes[idx].coords.length;
                    for (let c = 0; c < coordCount; c++) {
                        nodes[idx].coords[c].bufX = y;
                        if (this.alternateNodes) {
                            if (x + 1 <= Math.floor((segmentsPerCane + 1) / 2)) {
                                nodes[idx].coords[c].bufY = 2 * x;
                            } else {
                                nodes[idx].coords[c].bufY = (segmentsPerCane - (x + 1)) * 2 + 1;
                            }
                        } else {
                            nodes[idx].coords[c].bufY = x;
                        }
                    }

                    nodes[idx].logicalX = nodes[idx].coords[0].bufX;
                    nodes[idx].logicalY = nodes[idx].coords[0].bufY;
                }
            }
        }

        // Build lookup map from (bufX, bufY) to node index (like C++ FindNodeAtXY)
        const findNodeAtXY = (bufX: number, bufY: number): number => {
            for (let idx = 0; idx < nodes.length; idx++) {
                if (nodes[idx].coords.length > 0 &&
                    nodes[idx].coords[0].bufX === bufX &&
                    nodes[idx].coords[0].bufY === bufY) {
                    return idx;
                }
            }
            return -1;
        };

        // Set screen/model coordinates
        const lightsPerCane = segmentsPerCane * lightsPerNode;
        const angleRad = toRadians(this.angle);
        const mHeight = this.height; // screenLocation.GetMHeight() in C++

        const caneGap = 2.0;
        let upright = Math.floor(segmentsPerCane * 6.0 / 9.0);
        upright *= lightsPerNode;
        if (this.singleNode) {
            upright = Math.floor(lightsPerNode * 6.0 / 9.0);
        }
        const widthPerCane = lightsPerCane * 3.0 / 9.0;
        const width = numCanes * widthPerCane + (numCanes - 1) * caneGap;
        let height = lightsPerCane - widthPerCane / 2.0;

        if (this.sticks) {
            // Simple stick mode - straight vertical lines
            height = lightsPerCane * this.caneHeight;
            for (let i = 0; i < numCanes; i++) {
                let y = 0;
                const x = i * (widthPerCane + caneGap) + widthPerCane / 2.0;

                for (let n = 0; n < segmentsPerCane; n++) {
                    if (this.singleNode) {
                        const nodeIdx = n + i * segmentsPerCane;
                        if (nodeIdx >= nodeCount) continue;
                        const coordCount = nodes[nodeIdx].coords.length;
                        for (let c = 0; c < coordCount; c++) {
                            let screenX = x;
                            let screenY = this.caneHeight * y * mHeight;
                            const rotated = rotatePoint(x, 0, angleRad, screenX, screenY);
                            nodes[nodeIdx].coords[c].modelX = rotated.x;
                            nodes[nodeIdx].coords[c].modelY = rotated.y;
                            y++;
                        }
                    } else {
                        // Use FindNodeAtXY to handle alternateNodes
                        const nodeIdx = findNodeAtXY(i, Math.floor(y / lightsPerNode));
                        if (nodeIdx < 0) continue;
                        const coordCount = nodes[nodeIdx].coords.length;
                        for (let c = 0; c < coordCount; c++) {
                            let screenX = x;
                            let screenY = this.caneHeight * y * mHeight;
                            const rotated = rotatePoint(x, 0, angleRad, screenX, screenY);
                            nodes[nodeIdx].coords[c].modelX = rotated.x;
                            nodes[nodeIdx].coords[c].modelY = rotated.y;
                            y++;
                        }
                    }
                }
            }
        } else {
            // Full candy cane with hook
            const arclights = lightsPerCane - upright;

            for (let i = 0; i < numCanes; i++) {
                let x = i * (widthPerCane + caneGap);
                if (this.reverse) {
                    x += widthPerCane;
                }
                let y = 0;
                let curLight = 0;

                let cx = x;
                if (this.reverse) {
                    cx -= widthPerCane / 2 * mHeight;
                } else {
                    cx += widthPerCane / 2 * mHeight;
                }

                const ox = x;

                // Draw upright portion
                while (curLight < upright) {
                    if (this.singleNode) {
                        const nodeIdx = i * segmentsPerCane;
                        if (nodeIdx >= nodeCount) break;
                        const coordCount = upright;
                        for (let c = curLight; c < coordCount && curLight < upright; c++) {
                            let screenX = x;
                            let screenY = this.caneHeight * y * mHeight;
                            const rotated = rotatePoint(x, 0, angleRad, screenX, screenY);
                            nodes[nodeIdx].coords[c].modelX = rotated.x;
                            nodes[nodeIdx].coords[c].modelY = rotated.y;
                            y++;
                            curLight++;
                        }
                    } else {
                        // Use FindNodeAtXY to handle alternateNodes
                        const nodeIdx = findNodeAtXY(i, Math.floor(y / lightsPerNode));
                        if (nodeIdx < 0) {
                            curLight++;
                            y++;
                            continue;
                        }
                        const coordCount = nodes[nodeIdx].coords.length;
                        for (let c = 0; c < coordCount && curLight < upright; c++) {
                            let screenX = x;
                            let screenY = this.caneHeight * y * mHeight;
                            const rotated = rotatePoint(x, 0, angleRad, screenX, screenY);
                            nodes[nodeIdx].coords[c].modelX = rotated.x;
                            nodes[nodeIdx].coords[c].modelY = rotated.y;
                            y++;
                            curLight++;
                        }
                    }
                }

                y--;
                x = cx;

                // Draw arc portion
                while (curLight < lightsPerCane) {
                    if (this.singleNode) {
                        const nodeIdx = i * segmentsPerCane;
                        if (nodeIdx >= nodeCount) break;
                        const coordCount = lightsPerCane;
                        for (let c = curLight; c < coordCount && curLight < lightsPerCane; c++) {
                            const aangle = Math.PI - Math.PI * (curLight - upright + 1) / arclights;
                            const y2 = Math.sin(aangle) * widthPerCane / 2 * mHeight;
                            const x2 = Math.cos(aangle) * widthPerCane / 2 * mHeight;

                            let screenX: number;
                            if (this.reverse) {
                                screenX = x - x2;
                            } else {
                                screenX = x + x2;
                            }
                            const screenY = this.caneHeight * (y * mHeight + y2);

                            const rotated = rotatePoint(ox, 0, angleRad, screenX, screenY);
                            nodes[nodeIdx].coords[c].modelX = rotated.x;
                            nodes[nodeIdx].coords[c].modelY = rotated.y;
                            curLight++;
                        }
                    } else {
                        // Use FindNodeAtXY to handle alternateNodes
                        const nodeIdx = findNodeAtXY(i, Math.floor(curLight / lightsPerNode));
                        if (nodeIdx < 0) {
                            curLight++;
                            continue;
                        }
                        const coordCount = nodes[nodeIdx].coords.length;
                        for (let c = 0; c < coordCount && curLight < lightsPerCane; c++) {
                            const aangle = Math.PI - Math.PI * (curLight - upright + 1) / arclights;
                            const y2 = Math.sin(aangle) * widthPerCane / 2 * mHeight;
                            const x2 = Math.cos(aangle) * widthPerCane / 2 * mHeight;

                            let screenX: number;
                            if (this.reverse) {
                                screenX = x - x2;
                            } else {
                                screenX = x + x2;
                            }
                            const screenY = this.caneHeight * (y * mHeight + y2);

                            const rotated = rotatePoint(ox, 0, angleRad, screenX, screenY);
                            nodes[nodeIdx].coords[c].modelX = rotated.x;
                            nodes[nodeIdx].coords[c].modelY = rotated.y;
                            curLight++;
                        }
                    }
                }
            }
        }

        const scaleX = width > 0 ? 1 / width : 1;
        const toWorldCoords = getWorldMatrixFor3Pt(this, scaleX);

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

export const CandyCaneModelType: ModelType = {
    typeName: "Candy Canes",
    displayAs: "Candy Canes",
    modelXmlTag: 'candycanemodel',
};

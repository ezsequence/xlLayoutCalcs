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

import { toRadians } from "./utils";

const treeProperties: ModelProperty[] = [
    {name: 'TreeStringCount', ptype: "INTEGER", fieldName: 'numStrings', xmlName: 'NumStrings', description: "# Strings"},
    {name: 'TreeLightCount', ptype: "INTEGER", fieldName: 'pixelsPerString', xmlName: 'NodesPerString', description: "Nodes Per String"},
    {name: 'TreeStrandCount', ptype: "INTEGER", fieldName: 'strandsPerString', xmlName: 'StrandsPerString', description: "Strands Per String"},
    // Variant attributes — canonical form only (normalization splits the fork's
    // "Tree 360"/"Tree Flat"/"Tree Ribbon" DisplayAs into these).  Absent ⇒
    // class defaults (round 360), matching upstream deserialization.
    {name: 'TreeType', ptype: "INTEGER", fieldName: 'treeType', xmlName: 'TreeType', description: "Tree Type (0=Round, 1=Flat, 2=Ribbon)"},
    {name: 'TreeDegrees', ptype: "INTEGER", fieldName: 'degrees', xmlName: 'TreeDegrees', description: "Tree Degrees"},
    {name: 'TreeRotation', ptype: "FLOAT", fieldName: 'rotation', xmlName: 'TreeRotation', description: "Rotation"},
    {name: 'TreeSpiralRotations', ptype: "FLOAT", fieldName: 'spiralRotations', xmlName: 'TreeSpiralRotations', description: "Spiral Wraps"},
    {name: 'TreeBottomTopRatio', ptype: "FLOAT", fieldName: 'botTopRatio', xmlName: 'TreeBottomTopRatio', description: "Bottom/Top Ratio"},
    {name: 'TreePerspective', ptype: "FLOAT", fieldName: 'perspective', xmlName: 'TreePerspective', description: "Perspective"},
    {name: 'AlternateNodes', ptype: "BOOL", fieldName: 'alternateNodes', xmlName: 'AlternateNodes', description: "Alternate Nodes"},
    {name: 'NoZig', ptype: "BOOL", fieldName: 'noZig', xmlName: 'NoZig', description: "Don't Zig Zag"},
    {name: 'Dir', ptype: "STRING", fieldName: 'dir', xmlName: 'Dir', description: "Direction L/R"},
    {name: 'StartSide', ptype: "STRING", fieldName: 'startSide', xmlName: 'StartSide', description: "Start Side T/B"},
    {name: 'StrandDir', ptype: "STRING", fieldName: 'strandDir', xmlName: 'StrandDir', description: "Strand Direction"},
];

export class TreeModel extends BaseModelClass {
    modelType: ModelType = TreeModelType;
    numStrings: number = 16;
    pixelsPerString: number = 50;
    strandsPerString: number = 1;
    lightsPerNode: number = 1;
    singleNode: boolean = false;
    alternateNodes: boolean = false;
    noZig: boolean = false;
    dir: string = "L";
    startSide: string = "B";
    strandDir: string = "Vertical";

    treeType: number = 0; // 0=Round, 1=Flat, 2=Ribbon
    degrees: number = 360;
    rotation: number = 3;
    spiralRotations: number = 0;
    botTopRatio: number = 6.0;
    perspective: number = 0.2;

    constructor() {super();}

    getType(): string {
        return "Tree";
    }

    getProperties(): ModelProperty[] {
        return treeProperties;
    }

    getNumNodes() {
        if (this.singleNode) {
            return this.numStrings;  // One node per string in single node mode
        }
        return this.numStrings * this.pixelsPerString;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];

        const isHMatrix = this.strandDir === "Horizontal";
        const isLtoR = this.dir === 'L';
        const isBotToTop = this.startSide === 'B';

        let strandsPerString = this.strandsPerString;
        if (strandsPerString > this.pixelsPerString) {
            strandsPerString = this.pixelsPerString;
        }

        const numStrands = this.numStrings * strandsPerString;
        const pixelsPerStrand = Math.floor(this.pixelsPerString / strandsPerString);
        const pixelsPerString = pixelsPerStrand * strandsPerString;

        let logicalBufferWidth: number;
        let logicalBufferHeight: number;

        if (this.singleNode) {
            // Single node mode: one node per string, all lights as coords
            // Buffer collapses to numStrings × 1, all coords at same buffer position
            const nodeCount = this.numStrings;
            logicalBufferWidth = nodeCount;
            logicalBufferHeight = 1;

            for (let n = 0; n < nodeCount; n++) {
                const nn = defNodeLoc();
                nn.physicalNum = n;
                nn.physicalStrand = n;
                nn.physicalNumOnStrand = 0;
                nn.logicalNum = n;
                nn.logicalX = n;
                nn.logicalY = 0;

                // Create coords for all lights on this string - all at same buffer position
                for (let c = 0; c < pixelsPerString; c++) {
                    const coord = defNodeCoord();
                    coord.bufX = n;
                    coord.bufY = 0;
                    nn.coords.push(coord);
                }
                nodes.push(nn);
            }
        } else {
            // Normal mode
            const nodeCount = this.numStrings * pixelsPerString;

            // Create nodes - same as matrix
            for (let i = 0; i < nodeCount; ++i) {
                const nn = defNodeLoc();
                nn.coords.push(defNodeCoord());
                nodes.push(nn);
            }

            // Initialize buffer coordinates similar to matrix
            if (isHMatrix) {
                logicalBufferWidth = pixelsPerStrand;
                logicalBufferHeight = numStrands;

                for (let y = 0; y < numStrands; y++) {
                    const stringnum = Math.floor(y / strandsPerString);
                    const segmentnum = y % strandsPerString;

                    for (let x = 0; x < pixelsPerStrand; x++) {
                        const idx = stringnum * pixelsPerString + segmentnum * pixelsPerStrand + x;
                        if (idx >= nodeCount) continue;

                        nodes[idx].physicalNum = idx;
                        nodes[idx].physicalStrand = stringnum;
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

                        nodes[idx].logicalX = nodes[idx].coords[0].bufX;
                        nodes[idx].logicalY = nodes[idx].coords[0].bufY;
                    }
                }
            } else {
                // Vertical matrix (default for trees)
                logicalBufferWidth = numStrands;
                logicalBufferHeight = pixelsPerStrand;

                for (let x = 0; x < numStrands; x++) {
                    const stringnum = Math.floor(x / strandsPerString);
                    const segmentnum = x % strandsPerString;

                    for (let y = 0; y < pixelsPerStrand; y++) {
                        const idx = stringnum * pixelsPerString + segmentnum * pixelsPerStrand + y;
                        if (idx >= nodeCount) continue;

                        nodes[idx].physicalNum = idx;
                        nodes[idx].physicalStrand = stringnum;
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

                        nodes[idx].logicalX = nodes[idx].coords[0].bufX;
                        nodes[idx].logicalY = nodes[idx].coords[0].bufY;
                    }
                }
            }
        }

        // Now apply tree-specific 3D coordinates
        // For single node mode, use original matrix dimensions for 3D calculations
        const origBufferWi = numStrands;
        const origBufferHt = pixelsPerStrand;
        const BufferWi = this.singleNode ? origBufferWi : logicalBufferWidth;
        const BufferHt = this.singleNode ? origBufferHt : logicalBufferHeight;

        if (BufferWi < 1 || BufferHt < 1) {
            const toWorldCoords = getWorldMatrixForBoxed(this);
            const toWorld2DCoords = getWorldMatrixForBoxed(this, this.perspective);
            return { toWorldCoords, toWorld2DCoords, logicalBufferWidth, logicalBufferHeight, logicalBufferDepth: 1, nodes };
        }

        let RenderHt: number, RenderWi: number;

        if (this.degrees > 0) {
            // Round tree (3D)
            RenderHt = BufferHt * 3;
            RenderWi = RenderHt / 1.8;

            const radians = toRadians(this.degrees);
            let radius = RenderWi / 2.0;
            let topradius = radius;

            if (this.botTopRatio !== 0.0) {
                topradius = radius / Math.abs(this.botTopRatio);
            }
            if (this.botTopRatio < 0.0) {
                [topradius, radius] = [radius, topradius];
            }

            let StartAngle = -radians / 2.0;
            let AngleIncr = radians / BufferWi;
            if (this.degrees < 350 && BufferWi > 1) {
                AngleIncr = radians / (BufferWi - 1);
            }

            StartAngle += toRadians(this.rotation);

            // Pre-calculate y positions for spiral
            const yPos: number[] = [];
            const xInc: number[] = [];
            for (let i = 0; i < BufferHt; i++) {
                yPos.push(i);
                xInc.push(0);
            }

            if (this.spiralRotations !== 0.0) {
                const lengths: number[] = [];
                const rgap = (radius - topradius) / 10.0;
                let total = 0;

                for (let i = 0; i < 10; i++) {
                    let len = 2.0 * Math.PI * (radius - rgap * i) - rgap / 2.0;
                    len *= this.spiralRotations / 10.0;
                    len = Math.sqrt(len * len + (BufferHt / 10.0) * (BufferHt / 10.0));
                    lengths.push(len);
                    total += len;
                }

                let lights = 0;
                for (let i = 0; i < 10; i++) {
                    lengths[i] /= total;
                    lights += Math.round(lengths[i] * BufferHt);
                }

                let curSeg = 0;
                let lightsInSeg = Math.round(lengths[0] * BufferHt);
                let curLightInSeg = 0;

                for (let x = 1; x < BufferHt; x++) {
                    if (curLightInSeg >= lightsInSeg) {
                        curSeg++;
                        curLightInSeg = 0;
                        if (curSeg === 9) {
                            lightsInSeg = BufferHt - x;
                        } else {
                            lightsInSeg = Math.round(lengths[curSeg] * BufferHt);
                        }
                    }
                    const ang = (this.spiralRotations * 2.0 * Math.PI / 10.0) / lightsInSeg;
                    yPos[x] = yPos[x - 1] + (BufferHt / 10.0 / lightsInSeg);
                    xInc[x] = xInc[x - 1] + ang;
                    curLightInSeg++;
                }
            }

            const ytop = RenderHt;
            const ybot = 0.0;

            if (this.singleNode) {
                // Single node mode: calculate 3D coords based on original string/position
                for (let n = 0; n < nodes.length; n++) {
                    for (let c = 0; c < nodes[n].coords.length; c++) {
                        const coord = nodes[n].coords[c];
                        // Calculate original buffer position
                        const segmentnum = Math.floor(c / pixelsPerStrand);
                        const posInSegment = c % pixelsPerStrand;
                        const origBufX = isLtoR ? n * strandsPerString + segmentnum : numStrands - (n * strandsPerString + segmentnum) - 1;
                        const origBufY = isBotToTop ? posInSegment : pixelsPerStrand - posInSegment - 1;

                        const angle = StartAngle + origBufX * AngleIncr + xInc[origBufY];

                        const xb = radius * Math.sin(angle);
                        const xt = topradius * Math.sin(angle);
                        const zb = radius * Math.cos(angle);
                        const zt = topradius * Math.cos(angle);
                        const yb = ybot;
                        const yt = ytop;

                        let posOnString = 0.5;
                        if (BufferHt > 1) {
                            posOnString = yPos[origBufY] / (BufferHt - 1.0);
                        }

                        coord.modelX = xb + (xt - xb) * posOnString;
                        coord.modelY = yb + (yt - yb) * posOnString - RenderHt / 2.0;
                        coord.modelZ = zb + (zt - zb) * posOnString;
                    }
                }
            } else {
                for (const node of nodes) {
                    for (const coord of node.coords) {
                        const bufferX = coord.bufX;
                        const bufferY = coord.bufY;
                        const angle = StartAngle + bufferX * AngleIncr + xInc[bufferY];

                        const xb = radius * Math.sin(angle);
                        const xt = topradius * Math.sin(angle);
                        const zb = radius * Math.cos(angle);
                        const zt = topradius * Math.cos(angle);
                        const yb = ybot;
                        const yt = ytop;

                        let posOnString = 0.5;
                        if (BufferHt > 1) {
                            posOnString = yPos[bufferY] / (BufferHt - 1.0);
                        }

                        coord.modelX = xb + (xt - xb) * posOnString;
                        coord.modelY = yb + (yt - yb) * posOnString - RenderHt / 2.0;
                        coord.modelZ = zb + (zt - zb) * posOnString;
                    }
                }
            }
        } else {
            // Flat or Ribbon tree
            const treeScale = this.degrees === -1 ? 5.0 : 4.0;
            const botWid = BufferWi * treeScale;
            RenderHt = BufferHt * 2.0;
            RenderWi = botWid + 2;

            const offset = 0.5;

            if (this.degrees === -1) {
                // Ribbon tree - adds 2 extra coords per original coord
                if (this.singleNode) {
                    // Single node mode
                    for (let n = 0; n < nodes.length; n++) {
                        const origCoordCount = nodes[n].coords.length;
                        for (let c = 0; c < origCoordCount; c++) {
                            const coord = nodes[n].coords[c];
                            // Calculate original buffer position
                            const segmentnum = Math.floor(c / pixelsPerStrand);
                            const posInSegment = c % pixelsPerStrand;
                            const origBufX = isLtoR ? n * strandsPerString + segmentnum : numStrands - (n * strandsPerString + segmentnum) - 1;
                            const origBufY = isBotToTop ? posInSegment : pixelsPerStrand - posInSegment - 1;

                            const xt = (origBufX + offset - BufferWi / 2.0) * 0.9;
                            const xb = (origBufX + offset - BufferWi / 2.0) * treeScale;
                            const h = Math.sqrt(RenderHt * RenderHt + (xt - xb) * (xt - xb));

                            let posOnString = 0.5;
                            if (BufferHt > 1) {
                                posOnString = origBufY / (BufferHt - 1.0);
                            }
                            let newh = RenderHt * posOnString;
                            coord.modelX = xb + (xt - xb) * posOnString;
                            coord.modelY = RenderHt * newh / h - RenderHt / 2.0;
                            coord.modelZ = 0;

                            // Add coord offset by -0.33
                            posOnString = 0;
                            if (BufferHt > 1) {
                                posOnString = (origBufY - 0.33) / (BufferHt - 1.0);
                            }
                            newh = RenderHt * posOnString;
                            const coord2 = defNodeCoord();
                            coord2.bufX = coord.bufX;
                            coord2.bufY = coord.bufY;
                            coord2.modelX = xb + (xt - xb) * posOnString;
                            coord2.modelY = RenderHt * newh / h - RenderHt / 2.0;
                            coord2.modelZ = 0;
                            nodes[n].coords.push(coord2);

                            // Add coord offset by +0.33
                            posOnString = 1;
                            if (BufferHt > 1) {
                                posOnString = (origBufY + 0.33) / (BufferHt - 1.0);
                            }
                            newh = RenderHt * posOnString;
                            const coord3 = defNodeCoord();
                            coord3.bufX = coord.bufX;
                            coord3.bufY = coord.bufY;
                            coord3.modelX = xb + (xt - xb) * posOnString;
                            coord3.modelY = RenderHt * newh / h - RenderHt / 2.0;
                            coord3.modelZ = 0;
                            nodes[n].coords.push(coord3);
                        }
                    }
                } else {
                    for (const node of nodes) {
                        const origCoordCount = node.coords.length;
                        for (let c = 0; c < origCoordCount; c++) {
                            const coord = node.coords[c];
                            const bufferX = coord.bufX;
                            const bufferY = coord.bufY;

                            const xt = (bufferX + offset - BufferWi / 2.0) * 0.9;
                            const xb = (bufferX + offset - BufferWi / 2.0) * treeScale;
                            const h = Math.sqrt(RenderHt * RenderHt + (xt - xb) * (xt - xb));

                            // Original coord
                            let posOnString = 0.5;
                            if (BufferHt > 1) {
                                posOnString = bufferY / (BufferHt - 1.0);
                            }
                            let newh = RenderHt * posOnString;
                            coord.modelX = xb + (xt - xb) * posOnString;
                            coord.modelY = RenderHt * newh / h - RenderHt / 2.0;
                            coord.modelZ = 0;

                            // Add coord offset by -0.33
                            posOnString = 0;
                            if (BufferHt > 1) {
                                posOnString = (bufferY - 0.33) / (BufferHt - 1.0);
                            }
                            newh = RenderHt * posOnString;
                            const coord2 = defNodeCoord();
                            coord2.bufX = bufferX;
                            coord2.bufY = bufferY;
                            coord2.modelX = xb + (xt - xb) * posOnString;
                            coord2.modelY = RenderHt * newh / h - RenderHt / 2.0;
                            coord2.modelZ = 0;
                            node.coords.push(coord2);

                            // Add coord offset by +0.33
                            posOnString = 1;
                            if (BufferHt > 1) {
                                posOnString = (bufferY + 0.33) / (BufferHt - 1.0);
                            }
                            newh = RenderHt * posOnString;
                            const coord3 = defNodeCoord();
                            coord3.bufX = bufferX;
                            coord3.bufY = bufferY;
                            coord3.modelX = xb + (xt - xb) * posOnString;
                            coord3.modelY = RenderHt * newh / h - RenderHt / 2.0;
                            coord3.modelZ = 0;
                            node.coords.push(coord3);
                        }
                    }
                }
            } else {
                // Flat tree
                if (this.singleNode) {
                    // Single node mode
                    for (let n = 0; n < nodes.length; n++) {
                        for (let c = 0; c < nodes[n].coords.length; c++) {
                            const coord = nodes[n].coords[c];
                            // Calculate original buffer position
                            const segmentnum = Math.floor(c / pixelsPerStrand);
                            const posInSegment = c % pixelsPerStrand;
                            const origBufX = isLtoR ? n * strandsPerString + segmentnum : numStrands - (n * strandsPerString + segmentnum) - 1;
                            const origBufY = isBotToTop ? posInSegment : pixelsPerStrand - posInSegment - 1;

                            const xt = (origBufX + offset - BufferWi / 2.0) * 0.9;
                            const xb = (origBufX + offset - BufferWi / 2.0) * treeScale;

                            let posOnString = 0.5;
                            if (BufferHt > 1) {
                                posOnString = origBufY / (BufferHt - 1.0);
                            }

                            coord.modelX = xb + (xt - xb) * posOnString;
                            coord.modelY = RenderHt * posOnString - RenderHt / 2.0;
                            coord.modelZ = 0;
                        }
                    }
                } else {
                    for (const node of nodes) {
                        for (const coord of node.coords) {
                            const bufferX = coord.bufX;
                            const bufferY = coord.bufY;

                            const xt = (bufferX + offset - BufferWi / 2.0) * 0.9;
                            const xb = (bufferX + offset - BufferWi / 2.0) * treeScale;

                            let posOnString = 0.5;
                            if (BufferHt > 1) {
                                posOnString = bufferY / (BufferHt - 1.0);
                            }

                            coord.modelX = xb + (xt - xb) * posOnString;
                            coord.modelY = RenderHt * posOnString - RenderHt / 2.0;
                            coord.modelZ = 0;
                        }
                    }
                }
            }
        }

        // Tree uses BoxedScreenLocation with TreePerspective for 2D view
        const toWorldCoords = getWorldMatrixForBoxed(this);
        const toWorld2DCoords = getWorldMatrixForBoxed(this, this.perspective);

        return {
            toWorldCoords,
            toWorld2DCoords,
            logicalBufferWidth,
            logicalBufferHeight,
            logicalBufferDepth: 1,
            nodes,
        };
    }

    getBufferDescription(ind: EffectBufferDescriptionInput) {
        const ebdo = defEffectBufferDescriptionOutput();
        return ebdo;
    }
}

export const TreeModelType: ModelType = {
    typeName: "Tree",
    displayAs: "Tree",
    modelXmlTag: 'treemodel',
};

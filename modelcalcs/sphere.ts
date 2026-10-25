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

const sphereProperties: ModelProperty[] = [
    {name: 'SphereStringCount', ptype: "INTEGER", fieldName: 'numStrings', xmlName: 'NumStrings', description: "# Strings"},
    {name: 'SphereLightCount', ptype: "INTEGER", fieldName: 'pixelsPerString', xmlName: 'NodesPerString', description: "Nodes Per String"},
    {name: 'SphereStrandCount', ptype: "INTEGER", fieldName: 'strandsPerString', xmlName: 'StrandsPerString', description: "Strands Per String"},
    {name: 'StartLatitude', ptype: "INTEGER", fieldName: 'startLatitude', xmlName: 'StartLatitude', description: "Southern Latitude"},
    {name: 'EndLatitude', ptype: "INTEGER", fieldName: 'endLatitude', xmlName: 'EndLatitude', description: "Northern Latitude"},
    {name: 'Degrees', ptype: "INTEGER", fieldName: 'sphereDegrees', xmlName: 'Degrees', description: "Degrees"},
    {name: 'AlternateNodes', ptype: "BOOL", fieldName: 'alternateNodes', xmlName: 'AlternateNodes', description: "Alternate Nodes"},
    {name: 'NoZig', ptype: "BOOL", fieldName: 'noZig', xmlName: 'NoZig', description: "Don't Zig Zag"},
    {name: 'Dir', ptype: "STRING", fieldName: 'dir', xmlName: 'Dir', description: "Direction L/R"},
    {name: 'StartSide', ptype: "STRING", fieldName: 'startSide', xmlName: 'StartSide', description: "Start Side T/B"},
];

export class SphereModel extends BaseModelClass {
    modelType: ModelType = SphereModelType;
    numStrings: number = 8;
    pixelsPerString: number = 50;
    strandsPerString: number = 1;
    lightsPerNode: number = 1;
    singleNode: boolean = false;
    alternateNodes: boolean = false;
    noZig: boolean = false;
    dir: string = "L";
    startSide: string = "T";

    startLatitude: number = -86;
    endLatitude: number = 86;
    sphereDegrees: number = 360;

    constructor() {super();}

    getType(): string {
        return "Sphere";
    }

    getProperties(): ModelProperty[] {
        return sphereProperties;
    }

    getNumNodes() {
        if (this.singleNode) {
            return this.numStrings;  // One node per string in single node mode
        }
        return this.numStrings * this.pixelsPerString;
    }

    getNumPhysicalStrings(): number {
        return this.numStrings;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];

        // Similar to MatrixModel VMatrix initialization, then apply sphere coordinates
        let strandsPerString = this.strandsPerString;
        if (strandsPerString > this.pixelsPerString) {
            strandsPerString = this.pixelsPerString;
        }

        const numStrands = this.numStrings * strandsPerString;
        const pixelsPerStrand = Math.floor(this.pixelsPerString / strandsPerString);
        const pixelsPerString = pixelsPerStrand * strandsPerString;

        const isLtoR = this.dir === 'L';
        const isBotToTop = this.startSide === 'B';

        let logicalBufferWidth: number;
        let logicalBufferHeight: number;

        if (this.singleNode) {
            // Single node mode: one node per string, all lights as coords.
            // MatrixModel::InitSingleChannelModel, horizontal branch (a sphere
            // is never a vMatrix): one column, a row per string.
            const nodeCount = this.numStrings;
            logicalBufferWidth = 1;
            logicalBufferHeight = nodeCount;

            for (let n = 0; n < nodeCount; n++) {
                const nn = defNodeLoc();
                nn.physicalNum = n;
                nn.physicalStrand = n;
                nn.physicalNumOnStrand = 0;
                nn.logicalNum = n;
                const bufY = isLtoR ? n : numStrands - n - 1;
                nn.logicalX = 0;
                nn.logicalY = bufY;

                // Create coords for all lights on this string
                for (let c = 0; c < pixelsPerString; c++) {
                    const coord = defNodeCoord();
                    coord.bufX = 0;
                    coord.bufY = bufY;
                    nn.coords.push(coord);
                }
                nodes.push(nn);
            }
        } else {
            // Normal mode
            const nodeCount = this.numStrings * pixelsPerString;
            logicalBufferWidth = numStrands;
            logicalBufferHeight = pixelsPerStrand;

            // Create nodes
            for (let i = 0; i < nodeCount; ++i) {
                const nn = defNodeLoc();
                nn.coords.push(defNodeCoord());
                nodes.push(nn);
            }

            // Initialize buffer coordinates (VMatrix style)
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

        // Apply sphere coordinates
        // For sphere coords, we use the original matrix dimensions (not collapsed single node buffer)
        const sphereWidth = numStrands;
        const sphereHeight = pixelsPerStrand;

        if (sphereWidth < 1 || sphereHeight < 1) {
            const toWorldCoords = getWorldMatrixForBoxed(this);
            const toWorld2DCoords = getWorldMatrixForBoxed(this, 0.1);
            return { toWorldCoords, toWorld2DCoords, logicalBufferWidth, logicalBufferHeight, logicalBufferDepth: 1, nodes };
        }

        // xLights 2026.02+ (model versionNumber 8): one radius on every axis.
        const RenderMx = Math.max(sphereHeight, sphereWidth) / 1.8;

        const Hradians = toRadians(360);
        const Hradius = RenderMx / 2.0;
        const Vradius = RenderMx / 2.0;

        const remove = toRadians(360.0 - this.sphereDegrees);
        const fudge = toRadians((360.0 - this.sphereDegrees) / sphereWidth);
        const HStartAngle = Hradians / 4.0 + 0.003 - remove / 2.0;
        const HAngleIncr = (-Hradians + remove - fudge) / sphereWidth;

        const VStartAngle = toRadians(this.startLatitude - 90);
        const VAngleIncr = (toRadians(-1 * this.startLatitude) + toRadians(this.endLatitude)) / (sphereHeight - 1);

        if (this.singleNode) {
            // Single node mode: calculate sphere coords based on original strand/position
            for (let n = 0; n < nodes.length; n++) {
                const stringnum = n;
                for (let c = 0; c < nodes[n].coords.length; c++) {
                    // Calculate equivalent buffer position for sphere coords
                    const origBufX = isLtoR ? stringnum : this.numStrings - stringnum - 1;
                    const origBufY = isBotToTop ? c : pixelsPerString - c - 1;

                    const hangle = HStartAngle + origBufX * HAngleIncr;
                    const vangle = VStartAngle + origBufY * VAngleIncr;

                    const sv = Math.sin(vangle);
                    nodes[n].coords[c].modelX = Hradius * Math.cos(hangle) * sv;
                    nodes[n].coords[c].modelZ = Hradius * Math.sin(hangle) * sv;
                    nodes[n].coords[c].modelY = Vradius * Math.cos(vangle);
                }
            }
        } else {
            // Normal mode: use buffer coords directly
            for (const node of nodes) {
                for (const coord of node.coords) {
                    const bufferX = coord.bufX;
                    const bufferY = coord.bufY;
                    const hangle = HStartAngle + bufferX * HAngleIncr;
                    const vangle = VStartAngle + bufferY * VAngleIncr;

                    const sv = Math.sin(vangle);
                    coord.modelX = Hradius * Math.cos(hangle) * sv;
                    coord.modelZ = Hradius * Math.sin(hangle) * sv;
                    coord.modelY = Vradius * Math.cos(vangle);
                }
            }
        }

        // Sphere uses BoxedScreenLocation with 0.1 perspective for 2D view
        const toWorldCoords = getWorldMatrixForBoxed(this);
        const toWorld2DCoords = getWorldMatrixForBoxed(this, 0.1);

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

export const SphereModelType: ModelType = {
    typeName: "Sphere",
    displayAs: "Sphere",
    modelXmlTag: 'spheremodel',
};

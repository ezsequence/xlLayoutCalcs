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

const spinnerProperties: ModelProperty[] = [
    {name: 'SpinnerStringCount', ptype: "INTEGER", fieldName: 'numStrings', xmlName: 'NumStrings', description: "# Strings"},
    {name: 'SpinnerArmNodeCount', ptype: "INTEGER", fieldName: 'nodesPerArm', xmlName: 'NodesPerArm', description: "Lights/Arm"},
    {name: 'FoldCount', ptype: "INTEGER", fieldName: 'armsPerString', xmlName: 'ArmsPerString', description: "Arms/String"},
    {name: 'Hollow', ptype: "INTEGER", fieldName: 'hollow', xmlName: 'Hollow', description: "Hollow %"},
    {name: 'StartAngle', ptype: "INTEGER", fieldName: 'startAngle', xmlName: 'StartAngle', description: "Start Angle"},
    {name: 'Arc', ptype: "INTEGER", fieldName: 'arc', xmlName: 'Arc', description: "Arc"},
    {name: 'ZigZag', ptype: "BOOL", fieldName: 'zigzag', xmlName: 'ZigZag', description: "Zig-Zag Start"},
    {name: 'Alternate', ptype: "BOOL", fieldName: 'alternate', xmlName: 'Alternate', description: "Alternate"},
    {name: 'Dir', ptype: "STRING", fieldName: 'dir', xmlName: 'Dir', description: "Direction L/R"},
    {name: 'StartSide', ptype: "STRING", fieldName: 'startSide', xmlName: 'StartSide', description: "Start Side T/B"},
];

export class SpinnerModel extends BaseModelClass {
    modelType: ModelType = SpinnerModelType;
    numStrings: number = 3;
    nodesPerArm: number = 10;
    armsPerString: number = 3;
    lightsPerNode: number = 1;
    singleNode: boolean = false;
    hollow: number = 20;
    startAngle: number = 0;
    arc: number = 360;
    zigzag: boolean = false;
    alternate: boolean = false;
    dir: string = "L";
    startSide: string = "T";

    constructor() {super();}

    getType(): string {
        return "Spinner";
    }

    getProperties(): ModelProperty[] {
        return spinnerProperties;
    }

    getNumNodes() {
        if (this.singleNode) {
            return this.numStrings;  // One node per string in single node mode
        }
        return this.numStrings * this.nodesPerArm * this.armsPerString;
    }

    getNumPhysicalStrings(): number {
        return this.numStrings;
    }

    getChannelInfo() {
        return this.stringRunChannelInfo(this.numStrings);
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];

        const stringCount = this.numStrings;
        const nodesPerArm = this.nodesPerArm;
        const armsPerString = this.armsPerString;
        const armCount = armsPerString * stringCount;
        const lightsPerString = nodesPerArm * armsPerString;
        const nodeCount = this.getNumNodes();

        const isLtoR = this.dir === 'L';
        const isBotToTop = this.startSide === 'B';

        let logicalBufferWidth: number;
        let logicalBufferHeight: number;

        if (this.singleNode) {
            // Single node mode: one node per string, all lights as coords
            // Buffer X is reversed: n0 at rightmost column
            logicalBufferWidth = stringCount;
            logicalBufferHeight = 1;

            for (let n = 0; n < nodeCount; n++) {
                const nn = defNodeLoc();
                nn.physicalNum = n;
                nn.physicalStrand = n;
                nn.physicalNumOnStrand = 0;
                nn.logicalNum = n;
                nn.logicalX = stringCount - n - 1;
                nn.logicalY = 0;

                // Create coords for all lights on this string
                for (let c = 0; c < lightsPerString; c++) {
                    const coord = defNodeCoord();
                    // All coords at same buffer position (reversed column order)
                    coord.bufX = stringCount - n - 1;
                    coord.bufY = 0;
                    nn.coords.push(coord);
                }
                nodes.push(nn);
            }
        } else {
            logicalBufferWidth = armCount;
            logicalBufferHeight = nodesPerArm;

            // Create nodes
            for (let i = 0; i < nodeCount; ++i) {
                const nn = defNodeLoc();
                nn.coords.push(defNodeCoord());
                nodes.push(nn);
            }

            // Assign buffer coordinates
            for (let x = 0; x < armCount; x++) {
                for (let y = 0; y < nodesPerArm; y++) {
                    const idx = x * nodesPerArm + y;
                    if (idx >= nodeCount) continue;

                    nodes[idx].physicalNum = idx;
                    nodes[idx].physicalStrand = Math.floor(x / armsPerString);
                    nodes[idx].logicalNum = idx;

                    nodes[idx].coords[0].bufX = isLtoR ? x : armCount - x - 1;

                    if (this.alternate) {
                        if (y + 1 <= Math.floor((nodesPerArm + 1) / 2)) {
                            nodes[idx].coords[0].bufY = 2 * y;
                        } else {
                            nodes[idx].coords[0].bufY = (nodesPerArm - (y + 1)) * 2 + 1;
                        }
                        nodes[idx].coords[0].bufY = nodesPerArm - nodes[idx].coords[0].bufY - 1;
                    } else {
                        if (!this.zigzag) {
                            nodes[idx].coords[0].bufY = isBotToTop ? y : nodesPerArm - y - 1;
                        } else {
                            if (x % 2 === 0) {
                                nodes[idx].coords[0].bufY = isBotToTop ? y : nodesPerArm - y - 1;
                            } else {
                                nodes[idx].coords[0].bufY = isBotToTop ? nodesPerArm - y - 1 : y;
                            }
                        }
                    }

                    nodes[idx].logicalX = nodes[idx].coords[0].bufX;
                    nodes[idx].logicalY = nodes[idx].coords[0].bufY;
                }
            }
        }

        // Set spinner screen coordinates
        let angle = (Math.PI * 2.0 * (270.0 + this.startAngle)) / 360.0;
        let angleIncrement = (Math.PI * 2.0 * this.arc) / (stringCount * armsPerString * 360.0);

        if (this.arc < 360 && armsPerString * stringCount > 1) {
            angleIncrement = (Math.PI * 2.0 * this.arc) / ((stringCount * armsPerString - 1) * 360.0);
        }

        const cw = !isLtoR;
        const fromCentre = !isBotToTop;

        if (this.singleNode) {
            // Single node mode: calculate spinner coords for each coord based on original arm/position
            for (let s = 0; s < stringCount; s++) {
                let armAngle = angle;
                for (let arm = 0; arm < armsPerString; arm++) {
                    const a = s * armsPerString + arm;
                    for (let n = 0; n < nodesPerArm; n++) {
                        let n1: number;

                        if (this.alternate) {
                            if (n + 1 <= Math.floor((nodesPerArm + 1) / 2)) {
                                n1 = 2 * n;
                            } else {
                                n1 = (nodesPerArm - (n + 1)) * 2 + 1;
                            }
                        } else {
                            if (!fromCentre) {
                                n1 = nodesPerArm - n - 1;
                            } else {
                                n1 = n;
                            }

                            if (this.zigzag && a % 2 > 0) {
                                if (!fromCentre) {
                                    n1 = n;
                                } else {
                                    n1 = nodesPerArm - n - 1;
                                }
                            }
                        }

                        const coordIdx = arm * nodesPerArm + n;
                        if (coordIdx < nodes[s].coords.length) {
                            const hollowOffset = (this.hollow * 2.0 * nodesPerArm) / 100.0;
                            nodes[s].coords[coordIdx].modelX = (0.5 + n1 + hollowOffset) * Math.cos(armAngle);
                            nodes[s].coords[coordIdx].modelY = (0.5 + n1 + hollowOffset) * Math.sin(armAngle);
                        }
                    }

                    if (cw) {
                        armAngle -= angleIncrement;
                    } else {
                        armAngle += angleIncrement;
                    }
                }
                // Advance angle by all arms in this string
                if (cw) {
                    angle -= angleIncrement * armsPerString;
                } else {
                    angle += angleIncrement * armsPerString;
                }
            }
        } else {
            for (let a = 0; a < armCount; a++) {
                for (let n = 0; n < nodesPerArm; n++) {
                    let n1: number;

                    if (this.alternate) {
                        if (n + 1 <= Math.floor((nodesPerArm + 1) / 2)) {
                            n1 = 2 * n;
                        } else {
                            n1 = (nodesPerArm - (n + 1)) * 2 + 1;
                        }
                    } else {
                        if (!fromCentre) {
                            n1 = nodesPerArm - n - 1;
                        } else {
                            n1 = n;
                        }

                        if (this.zigzag && a % 2 > 0) {
                            if (!fromCentre) {
                                n1 = n;
                            } else {
                                n1 = nodesPerArm - n - 1;
                            }
                        }
                    }

                    const idx = n + a * nodesPerArm;
                    if (idx >= nodes.length) continue;

                    const hollowOffset = (this.hollow * 2.0 * nodesPerArm) / 100.0;
                    nodes[idx].coords[0].modelX = (0.5 + n1 + hollowOffset) * Math.cos(angle);
                    nodes[idx].coords[0].modelY = (0.5 + n1 + hollowOffset) * Math.sin(angle);
                }

                if (cw) {
                    angle -= angleIncrement;
                } else {
                    angle += angleIncrement;
                }
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

    getBufferDescription(ind: EffectBufferDescriptionInput) {
        const ebdo = defEffectBufferDescriptionOutput();
        return ebdo;
    }
}

export const SpinnerModelType: ModelType = {
    typeName: "Spinner",
    displayAs: "Spinner",
    modelXmlTag: 'spinnermodel',
};

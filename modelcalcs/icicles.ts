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

import { mat4 } from "gl-matrix";

const iciclesProperties: ModelProperty[] = [
    {name: 'IciclesStrings', ptype: "INTEGER", fieldName: 'numStrings', xmlName: 'NumStrings', description: "# Strings"},
    {name: 'IciclesLights', ptype: "INTEGER", fieldName: 'lightsPerString', xmlName: 'NodesPerString', description: "Lights Per String"},
    {name: 'IciclesParm3', ptype: "INTEGER", fieldName: 'parm3', xmlName: 'parm3', description: "Parameter 3 (unused)"},
    {name: 'DropPattern', ptype: "STRING", fieldName: 'dropPattern', xmlName: 'DropPattern', description: "Drop Pattern"},
    {name: 'AlternateNodes', ptype: "BOOL", fieldName: 'alternateNodes', xmlName: 'AlternateNodes', description: "Alternate Nodes"},
    {name: 'Dir', ptype: "STRING", fieldName: 'dir', xmlName: 'Dir', description: "Direction L/R"},
    {name: 'Height', ptype: "FLOAT", fieldName: 'height', xmlName: 'Height', description: "Model Height"},
    {name: 'Shear', ptype: "FLOAT", fieldName: 'shear', xmlName: 'Shear', description: "Model Shear"},
];

export class IciclesModel extends BaseModelClass {
    modelType: ModelType = IciclesModelType;
    numStrings: number = 1;
    lightsPerString: number = 50;
    parm3: number = 1;  // Not used in calculations but may exist in XML
    lightsPerNode: number = 1;
    singleNode: boolean = false;
    dropPattern: string = "3,4,5,4";
    alternateNodes: boolean = false;
    dir: string = "L";
    height: number = -0.5;  // Screen location property (default from C++)
    shear: number = 0;      // Screen location property

    constructor() {super();}

    getType(): string {
        return "Icicles";
    }

    getProperties(): ModelProperty[] {
        return iciclesProperties;
    }

    getNumNodes() {
        if (this.singleNode) {
            return this.numStrings;  // One node per string in single node mode
        }
        return this.numStrings * this.lightsPerString;
    }

    getNumPhysicalStrings(): number {
        return this.numStrings;
    }

    parseDropPattern(): number[] {
        const sizes: number[] = [];
        const parts = this.dropPattern.split(',');
        for (const part of parts) {
            const d = parseInt(part.trim() || '0');
            sizes.push(d);
        }
        if (sizes.length === 0) {
            sizes.push(5);
        }
        return sizes;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];
        let logicalBufferWidth = 1, logicalBufferHeight = 1, logicalBufferDepth = 1;

        const nodeCount = this.getNumNodes();
        const isLtoR = this.dir === 'L';
        const dropSizes = this.parseDropPattern();

        // Find max height
        let maxH = 0;
        for (const d of dropSizes) {
            maxH = Math.max(maxH, d);
        }

        // Create nodes
        if (this.singleNode) {
            // Single node mode: one node per string, all lights as coords
            const lightsPerString = this.lightsPerString * this.lightsPerNode;
            for (let i = 0; i < nodeCount; ++i) {
                const nn = defNodeLoc();
                for (let c = 0; c < lightsPerString; ++c) {
                    nn.coords.push(defNodeCoord());
                }
                nodes.push(nn);
            }
        } else {
            for (let i = 0; i < nodeCount; ++i) {
                const nn = defNodeLoc();
                for (let c = 0; c < this.lightsPerNode; ++c) {
                    nn.coords.push(defNodeCoord());
                }
                nodes.push(nn);
            }
        }

        if (this.singleNode) {
            // Single node mode: one node per string, all lights as coords
            // Buffer still follows icicle pattern (same as normal mode)
            let width = -1;
            let curCoord = 0;

            for (let n = 0; n < nodeCount; n++) {
                nodes[n].physicalNum = n;
                nodes[n].physicalStrand = n;
                nodes[n].physicalNumOnStrand = 0;
                nodes[n].logicalNum = n;

                let lights = this.lightsPerString;
                let y = 0;
                let curDrop = 0;
                let nodesInDrop = dropSizes[curDrop];
                width++;

                while (lights > 0) {
                    // Move to next drop if needed
                    while (y >= dropSizes[curDrop]) {
                        width++;
                        y = 0;
                        curDrop++;
                        if (curDrop >= dropSizes.length) {
                            curDrop = 0;
                        }
                        nodesInDrop = dropSizes[curDrop];
                    }

                    nodes[n].coords[curCoord].bufX = width;

                    // Store screen coordinates like C++ (positive Y, will be transformed later)
                    let screenY: number;
                    if (this.alternateNodes) {
                        if (y + 1 <= Math.floor((nodesInDrop + 1) / 2)) {
                            nodes[n].coords[curCoord].bufY = maxH - 1 - (2 * y);
                            screenY = 2 * y;
                        } else {
                            nodes[n].coords[curCoord].bufY = maxH - 1 - ((nodesInDrop - (y + 1)) * 2 + 1);
                            screenY = (nodesInDrop - (y + 1)) * 2 + 1;
                        }
                    } else {
                        nodes[n].coords[curCoord].bufY = maxH - y - 1;
                        screenY = y;
                    }

                    // Store screen X (will normalize after we know final width)
                    nodes[n].coords[curCoord].modelX = width;
                    nodes[n].coords[curCoord].modelY = screenY;

                    lights--;
                    y++;
                    curCoord++;
                }

                // Set logical position from first coord of this node
                if (nodes[n].coords.length > 0) {
                    nodes[n].logicalX = nodes[n].coords[0].bufX;
                    nodes[n].logicalY = nodes[n].coords[0].bufY;
                }

                curCoord = 0; // Reset for next node
            }

            // Apply direction to buffer coords
            if (!isLtoR) {
                for (const node of nodes) {
                    for (const cd of node.coords) {
                        cd.bufX = width - cd.bufX;
                    }
                }
            }

            logicalBufferHeight = maxH;
            logicalBufferWidth = width + 1;

            // Model coordinates use raw integers (not normalized)
            // Apply direction to model X coords
            if (!isLtoR) {
                for (const node of nodes) {
                    for (const cd of node.coords) {
                        cd.modelX = width - cd.modelX;
                    }
                }
            }

            // Handle single icicle - center it
            if (width === 0) {
                for (const n of nodes) {
                    for (const c of n.coords) {
                        c.modelX = 0.5;
                    }
                }
            }
        } else {
            let width = -1;
            let curNode = 0;
            let curCoord = 0;

            for (let x = 0; x < this.numStrings; x++) {
                let lights = this.lightsPerString;
                let y = 0;
                let curDrop = 0;
                let nodesInDrop = dropSizes[curDrop];
                width++;

                while (lights > 0) {
                    if (curNode >= nodeCount) break;
                    if (curCoord >= nodes[curNode].coords.length) {
                        curNode++;
                        curCoord = 0;
                    }
                    if (curNode >= nodeCount) break;

                    // Move to next drop if needed
                    while (y >= dropSizes[curDrop]) {
                        width++;
                        y = 0;
                        curDrop++;
                        if (curDrop >= dropSizes.length) {
                            curDrop = 0;
                        }
                        nodesInDrop = dropSizes[curDrop];
                    }

                    nodes[curNode].physicalNum = curNode;
                    nodes[curNode].physicalStrand = x;
                    nodes[curNode].logicalNum = curNode;

                    nodes[curNode].coords[curCoord].bufX = width;

                    // Store screen coordinates like C++ (positive Y, will be transformed later)
                    let screenY: number;
                    if (this.alternateNodes) {
                        if (y + 1 <= Math.floor((nodesInDrop + 1) / 2)) {
                            nodes[curNode].coords[curCoord].bufY = maxH - 1 - (2 * y);
                            screenY = 2 * y;
                        } else {
                            nodes[curNode].coords[curCoord].bufY = maxH - 1 - ((nodesInDrop - (y + 1)) * 2 + 1);
                            screenY = (nodesInDrop - (y + 1)) * 2 + 1;
                        }
                    } else {
                        nodes[curNode].coords[curCoord].bufY = maxH - y - 1;
                        screenY = y;
                    }

                    // Store screen X (will normalize after we know final width)
                    nodes[curNode].coords[curCoord].modelX = width;
                    nodes[curNode].coords[curCoord].modelY = screenY;

                    lights--;
                    y++;
                    curCoord++;
                }
            }

            // Apply direction to buffer coords
            if (!isLtoR) {
                for (const node of nodes) {
                    for (const cd of node.coords) {
                        cd.bufX = width - cd.bufX;
                    }
                }
            }

            logicalBufferHeight = maxH;
            logicalBufferWidth = width + 1;

            // Model coordinates use raw integers (not normalized)
            // Apply direction to model X coords
            if (!isLtoR) {
                for (const node of nodes) {
                    for (const cd of node.coords) {
                        cd.modelX = width - cd.modelX;
                    }
                }
            }

            // Handle single icicle - center it
            if (width === 0) {
                for (const n of nodes) {
                    for (const c of n.coords) {
                        c.modelX = 0.5;
                    }
                }
            }

            // Set logical positions from first coord
            for (const node of nodes) {
                if (node.coords.length > 0) {
                    node.logicalX = node.coords[0].bufX;
                    node.logicalY = node.coords[0].bufY;
                }
            }
        }

        // Model coordinates are raw integers (width, Y values)
        // Create a normalization matrix to convert them to 0-1 range before 3pt transform
        // X: divide by width (max index, not count), Y: divide by width then scale by height
        // This matches the original C++ normalization: x/width, y/width * height
        const renderWidth = Math.max(logicalBufferWidth - 1, 1);  // Max index, not count
        const mHeight = this.height;

        const normalizeMatrix = mat4.create();
        mat4.scale(normalizeMatrix, mat4.create(), [1.0 / renderWidth, mHeight / renderWidth, 1.0]);

        // Get base 3-point transform (expects 0-1 normalized coords)
        const baseMatrix = getWorldMatrixFor3Pt(this, 1.0, this.shear);

        // Combine: baseMatrix * normalizeMatrix
        // This normalizes raw coords first, then applies 3pt world transform
        const toWorldCoords = mat4.create();
        mat4.multiply(toWorldCoords, baseMatrix, normalizeMatrix);

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

export const IciclesModelType: ModelType = {
    typeName: "Icicles",
    displayAs: "Icicles",
    modelXmlTag: 'iciclemodel',
};

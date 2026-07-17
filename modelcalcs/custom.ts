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

const customProperties: ModelProperty[] = [
    {name: 'CustomWidth', ptype: "INTEGER", fieldName: 'customWidth', xmlName: 'CustomWidth', description: "Width"},
    {name: 'CustomHeight', ptype: "INTEGER", fieldName: 'customHeight', xmlName: 'CustomHeight', description: "Height"},
    {name: 'parm3', ptype: "INTEGER", fieldName: 'parm3', xmlName: 'parm3', description: "Unused parameter"},
    {name: 'CustomDepth', ptype: "INTEGER", fieldName: 'customDepth', xmlName: 'Depth', description: "Depth"},
    {name: 'CustomModel', ptype: "STRING", fieldName: 'customModel', xmlName: 'CustomModel', description: "Model Data"},
    {name: 'CustomModelCompressed', ptype: "STRING", fieldName: 'customModelCompressed', xmlName: 'CustomModelCompressed', description: "Compressed Model Data"},
    {name: 'CustomStrings', ptype: "INTEGER", fieldName: 'numStrings', xmlName: 'CustomStrings', description: "# Strings"},
    // Note: String1, String2, ... StringN are dynamic properties parsed based on CustomStrings
    // They represent the starting node number for each string
];

// Parse custom model string format: "1,2,3;4,5,6|7,8,9;10,11,12"
// Where | separates layers, ; separates rows, , separates columns
function parseCustomModel(customModel: string): number[][][] {
    const locations: number[][][] = [];
    let width = 1;

    const layers = customModel.split('|');

    for (const lv of layers) {
        const layerData: number[][] = [];
        const rows = lv.split(';');

        for (const rv of rows) {
            const cols = rv.split(',');
            if (cols.length > width) {
                width = cols.length;
            }

            const rowData: number[] = [];
            for (const value of cols) {
                const trimmed = value.trim();
                if (trimmed !== '') {
                    const num = parseInt(trimmed);
                    rowData.push(isNaN(num) ? -1 : num);
                } else {
                    rowData.push(-1);
                }
            }
            layerData.push(rowData);
        }
        locations.push(layerData);
    }

    // Ensure all rows have the same width
    for (const layer of locations) {
        for (const row of layer) {
            while (row.length < width) {
                row.push(-1);
            }
        }
    }

    return locations;
}

// Parse compressed format: "node,row,col[,layer];node,row,col[,layer];..."
// Dimensions are derived elsewhere as they cannot be represented in this form.
function parseCompressed(compressed: string): number[][][] {
    const nodes: [number, number, number, number][] = [];

    const nodeStrings = compressed.split(';');
    for (const n of nodeStrings) {
        if (n.trim() === '') continue;
        const nodeData = n.split(',');
        if (nodeData.length === 3) {
            nodes.push([parseInt(nodeData[0]), parseInt(nodeData[1]), parseInt(nodeData[2]), 0]);
        } else if (nodeData.length === 4) {
            nodes.push([parseInt(nodeData[0]), parseInt(nodeData[1]), parseInt(nodeData[2]), parseInt(nodeData[3])]);
        }
    }

    // Work out required dimensions
    let layers = 0, rows = 0, cols = 0;
    for (const n of nodes) {
        layers = Math.max(layers, n[3]);
        rows = Math.max(rows, n[1]);
        cols = Math.max(cols, n[2]);
    }

    // Create the 3D array
    const locations: number[][][] = [];
    for (let l = 0; l <= layers; l++) {
        const layerData: number[][] = [];
        for (let r = 0; r <= rows; r++) {
            const rowData: number[] = [];
            for (let c = 0; c <= cols; c++) {
                rowData.push(-1);
            }
            layerData.push(rowData);
        }
        locations.push(layerData);
    }

    // Fill in the data
    for (const n of nodes) {
        const [nodeNum, row, col, layer] = n;
        if (layer < locations.length && row < locations[layer].length && col < locations[layer][row].length) {
            locations[layer][row][col] = nodeNum;
        }
    }

    return locations;
}

export class CustomModel extends BaseModelClass {
    modelType: ModelType = CustomModelType;
    customWidth: number = 10;
    customHeight: number = 10;
    parm3: number = 1;  // Not used by custom model, but may be in XML
    customDepth: number = 1;
    customModel: string = "";
    customModelCompressed: string = "";
    numStrings: number = 1;
    lightsPerNode: number = 1;
    singleNode: boolean = false;

    // Dynamic string start nodes (String1, String2, etc.)
    // Key is string index (0-based), value is starting node number for that string
    stringStartNodes: Map<number, number> = new Map();

    constructor() {super();}

    getType(): string {
        return "Custom";
    }

    getProperties(): ModelProperty[] {
        return customProperties;
    }

    getNumNodes(): number {
        // Count unique non-zero values in the model
        const locations = this.parseModelData();
        const nodeSet = new Set<number>();
        for (const layer of locations) {
            for (const row of layer) {
                for (const col of row) {
                    if (col > 0) {
                        nodeSet.add(col);
                    }
                }
            }
        }
        return nodeSet.size;
    }

    parseModelData(): number[][][] {
        // Either attribute may be present but degenerate (e.g. newer xLights
        // writes CustomModel="" alongside real CustomModelCompressed data);
        // prefer whichever actually contains node numbers, compressed first.
        if (/\d/.test(this.customModelCompressed)) {
            return parseCompressed(this.customModelCompressed);
        }
        return parseCustomModel(this.customModel);
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];

        const locations = this.parseModelData();

        // Defensive checks for empty/malformed data
        if (locations.length === 0 || locations[0].length === 0 || !locations[0][0] || locations[0][0].length === 0) {
            const toWorldCoords = getWorldMatrixForBoxed(this);
            const toWorld2DCoords = getWorldMatrixForBoxed(this); // No perspective for empty model
            return { toWorldCoords, toWorld2DCoords, logicalBufferWidth: 1, logicalBufferHeight: 1, logicalBufferDepth: 1, nodes };
        }

        // Parsed data dimensions - used for model/screen coordinates (matches C++)
        const depth = locations.length;
        const height = locations[0].length;
        const width = locations[0][0].length;

        // Find maximum node number
        let maxval = 0;
        for (const layer of locations) {
            for (const row of layer) {
                for (const col of row) {
                    if (col > 0) {
                        maxval = Math.max(maxval, col);
                    }
                }
            }
        }

        const nodemap: number[] = new Array(maxval + 1).fill(-1);

        // C++ uses two sources of truth:
        // 1. Parsed data dimensions (width, height, depth) for screen/model coordinates
        // 2. XML parm values (parm1, parm2, Depth) for buffer size
        // If customDepth is 0 (empty Depth="" in XML), use parsed data depth instead
        const parmWidth = this.customWidth;
        const parmHeight = this.customHeight;
        const parmDepth = this.customDepth > 0 ? this.customDepth : depth;

        // Populate nodes
        for (let layerIdx = 0; layerIdx < depth; layerIdx++) {
            const layer = locations[layerIdx];
            for (let rowIdx = 0; rowIdx < layer.length; rowIdx++) {
                const row = layer[rowIdx];
                for (let colIdx = 0; colIdx < row.length; colIdx++) {
                    const c = row[colIdx];
                    if (c > 0) {
                        const idx = c - 1; // index is zero-based

                        if (nodemap[idx] < 0) {
                            // New node
                            nodemap[idx] = nodes.length;
                            const nn = defNodeLoc();
                            nn.physicalNum = idx;
                            nn.logicalNum = idx;

                            const coord = defNodeCoord();
                            // Buffer coords use parsed data dimensions (matches C++ line 950)
                            coord.bufX = layerIdx * width + colIdx;
                            coord.bufY = height - rowIdx - 1;
                            // Model coords use parsed data dimensions (matches C++ lines 952-954)
                            coord.modelX = colIdx - width / 2.0;
                            coord.modelY = height - rowIdx - 1.0 - height / 2.0;
                            coord.modelZ = depth - layerIdx - 1.0 - depth / 2.0;

                            nn.coords.push(coord);
                            nn.logicalX = coord.bufX;
                            nn.logicalY = coord.bufY;
                            nodes.push(nn);
                        } else {
                            // Add coord to existing node
                            const existingNode = nodes[nodemap[idx]];
                            const coord = defNodeCoord();
                            // Buffer coords use parsed data dimensions (matches C++ line 957)
                            coord.bufX = layerIdx * width + colIdx;
                            coord.bufY = height - rowIdx - 1;
                            // Model coords use parsed data dimensions (matches C++ lines 959-961)
                            coord.modelX = colIdx - width / 2.0;
                            coord.modelY = height - rowIdx - 1.0 - height / 2.0;
                            coord.modelZ = depth - layerIdx - 1.0 - depth / 2.0;
                            existingNode.coords.push(coord);
                        }
                    }
                }
            }
        }

        // Sort nodes by their physical number
        nodes.sort((a, b) => a.physicalNum - b.physicalNum);

        // C++ does: SetBufferSize(parm2, parm1 * _depth);
        // where parm2 = height, parm1 * _depth = width
        const logicalBufferWidth = this.customWidth * this.customDepth;
        const logicalBufferHeight = this.customHeight;
        const logicalBufferDepth = this.customDepth;

        // 3D world matrix (no perspective)
        const toWorldCoords = getWorldMatrixForBoxed(this);

        // 2D world matrix - apply 0.1 radian perspective tilt for models with depth > 1
        // This matches C++: if (_depth > 1) screenLocation.SetPerspective2D(0.1f);
        // Use XML parameter (customDepth) not parsed data depth
        const perspective2D = this.customDepth > 1 ? 0.1 : 0;
        const toWorld2DCoords = getWorldMatrixForBoxed(this, perspective2D);

        return {
            toWorldCoords,
            toWorld2DCoords,
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

export const CustomModelType: ModelType = {
    typeName: "Custom",
    displayAs: "Custom",
    modelXmlTag: 'custommodel',
};

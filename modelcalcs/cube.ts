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

// Transformation table for different start locations and styles
const transformations: [number, number, number, number][] = [
    [1, 0, -1, 0],   // FBL V FB
    [0, 0, -1, 1],   //     V LR
    [0, -1, 0, 1],   //     H FB
    [0, 0, 0, 0],    //     H LR
    [-1, 2, 0, 1],   //     S FB
    [-1, -1, 0, 0],  //     S LR
    [1, 0, -1, 1],   // FBR V FB
    [0, 0, -1, 0],   //     V LR
    [0, -1, 0, 0],   //     H FB
    [0, 0, 0, 1],    //     H LR
    [-1, 2, 0, 0],   //     S FB
    [-1, -1, 0, 1],  //     S LR
    [1, 0, 1, 1],    // FTL V FB
    [0, 0, 1, 0],    //     V LR
    [0, -1, 2, 0],   //     H FB
    [0, 0, 2, 1],    //     H LR
    [-1, 2, 2, 0],   //     S FB
    [-1, -1, 2, 1],  //     S LR
    [1, 0, 1, 0],    // FTR V FB
    [0, 0, 1, 1],    //     V LR
    [0, -1, 2, 1],   //     H FB
    [0, 0, 2, 0],    //     H LR
    [-1, 2, 2, 1],   //     S FB
    [-1, -1, 2, 0],  //     S LR
    [-1, 0, -1, 1],  // BBL V FB
    [0, 2, 1, 0],    //     V LR
    [0, 1, 0, 0],    //     H FB
    [0, 2, 0, 1],    //     H LR
    [-1, 0, 0, 0],   //     S FB
    [-1, 1, 0, 1],   //     S LR
    [-1, 0, -1, 0],  // BBR V FB
    [0, 2, 1, 1],    //     V LR
    [0, 1, 0, 1],    //     H FB
    [0, 2, 0, 0],    //     H LR
    [-1, 0, 0, 1],   //     S FB
    [-1, 1, 0, 0],   //     S LR
    [-1, 0, 1, 0],   // BTL V FB
    [0, 2, -1, 1],   //     V LR
    [0, -1, 2, 0],   //     H FB
    [2, 0, 0, 0],    //     H LR
    [-1, 2, 2, 0],   //     S FB
    [1, -1, 0, 0],   //     S LR
    [-1, 0, 1, 1],   // BTR V FB
    [0, 2, -1, 0],   //     V LR
    [0, -1, 2, 1],   //     H FB
    [2, 0, 0, 1],    //     H LR
    [-1, 2, 2, 1],   //     S FB
    [1, -1, 0, 1]    //     S LR
];

const startLocations = [
    "Front Bottom Left", "Front Bottom Right", "Front Top Left", "Front Top Right",
    "Back Bottom Left", "Back Bottom Right", "Back Top Left", "Back Top Right"
];

const cubeStyles = [
    "Vertical Front/Back", "Vertical Left/Right",
    "Horizontal Front/Back", "Horizontal Left/Right",
    "Stacked Front/Back", "Stacked Left/Right"
];

// Note: "Aternate Pixel" is a typo in the original C++ code (missing 'l')
// We must match it exactly for XML compatibility
const strandStyles = ["Zig Zag", "No Zig Zag", "Aternate Pixel"];

const cubeProperties: ModelProperty[] = [
    {name: 'CubeWidth', ptype: "INTEGER", fieldName: 'width', xmlName: 'CubeWidth', description: "Width"},
    {name: 'CubeHeight', ptype: "INTEGER", fieldName: 'height', xmlName: 'CubeHeight', description: "Height"},
    {name: 'CubeDepth', ptype: "INTEGER", fieldName: 'depth', xmlName: 'CubeDepth', description: "Depth"},
    {name: 'CubeStrings', ptype: "INTEGER", fieldName: 'numStrings', xmlName: 'Strings', description: "# Strings"},
    {name: 'Start', ptype: "STRING", fieldName: 'start', xmlName: 'Start', description: "Starting Location"},
    {name: 'Style', ptype: "STRING", fieldName: 'style', xmlName: 'Style', description: "Direction"},
    {name: 'StrandPerLine', ptype: "STRING", fieldName: 'strandPerLine', xmlName: 'StrandPerLine', description: "Strand Style"},
    {name: 'StrandPerLayer', ptype: "BOOL", fieldName: 'strandPerLayer', xmlName: 'StrandPerLayer', description: "Layers Start Same Place"},
    // Cylindrical-cube support (xLights 2026 new-format only).
    {name: 'CubeShape', ptype: "INTEGER", fieldName: 'cubeShape', xmlName: 'CubeShape', description: "Shape (0=Cube, 1=Cylinder)"},
    {name: 'CubeHollow', ptype: "INTEGER", fieldName: 'hollowPct', xmlName: 'CubeHollow', description: "Hollow % (cylinder only)"},
    {name: 'CubeRowOffset', ptype: "INTEGER", fieldName: 'rowOffset', xmlName: 'CubeRowOffset', description: "Row Offset (0=None, 1=Positive, 2=Negative)"},
];

export class CubeModel extends BaseModelClass {
    modelType: ModelType = CubeModelType;
    width: number = 5;
    height: number = 5;
    depth: number = 5;
    numStrings: number = 1;
    lightsPerNode: number = 1;
    singleNode: boolean = false;
    start: string = "Front Bottom Left";
    style: string = "Horizontal Left/Right";
    strandPerLine: string = "Zig Zag";
    strandPerLayer: boolean = false;
    /** 0 = Cube, 1 = Cylinder (CubeModel::CubeShape). */
    cubeShape: number = 0;
    /** Cylinder hollow percentage 0..99 (CubeModel::_hollowPct). */
    hollowPct: number = 0;
    /** 0 = None, 1 = Positive, 2 = Negative (CubeModel::RowOffset, cube shape only). */
    rowOffset: number = 0;

    constructor() {super();}

    getType(): string {
        return "Cube";
    }

    getProperties(): ModelProperty[] {
        return cubeProperties;
    }

    getNumNodes() {
        if (this.singleNode) {
            return this.numStrings;  // One node per string in single node mode
        }
        return this.width * this.height * this.depth;
    }

    getStartIndex(): number {
        const idx = startLocations.indexOf(this.start);
        return idx >= 0 ? idx : 0;
    }

    getStyleIndex(): number {
        const idx = cubeStyles.indexOf(this.style);
        return idx >= 0 ? idx : 3;
    }

    getStrandStyleIndex(): number {
        const idx = strandStyles.indexOf(this.strandPerLine);
        // C++ returns 3 when StrandPerLine is empty or invalid
        // Index 3 acts like "Zig Zag" for row pattern but doesn't flip x on odd layers
        return idx >= 0 ? idx : 3;
    }

    calcTransformationIndex(): number {
        const leftright = this.style.includes("Left");
        const horizontal = this.style.includes("Horizontal");
        const stacked = this.style.includes("Stacked");
        return (this.getStartIndex() * 6) + (horizontal ? 2 : 0) + (stacked ? 4 : 0) + (leftright ? 1 : 0);
    }

    flipX(pt: [number, number, number], w: number): [number, number, number] {
        pt[0] = w - pt[0] - 1;
        return pt;
    }

    rotateY90Degrees(pt: [number, number, number], by: number, w: number, d: number): [number, number, number] {
        for (let i = 0; i < Math.abs(by); i++) {
            if (by > 0) {
                const temp = pt[2];
                pt[2] = w - pt[0] - 1;
                pt[0] = temp;
            } else {
                const temp = pt[0];
                pt[0] = d - pt[2] - 1;
                pt[2] = temp;
            }
            [w, d] = [d, w];
        }
        return pt;
    }

    rotateZ90Degrees(pt: [number, number, number], by: number, w: number, h: number): [number, number, number] {
        for (let i = 0; i < Math.abs(by); i++) {
            if (by > 0) {
                const temp = pt[0];
                pt[0] = pt[1];
                pt[1] = w - temp - 1;
            } else {
                const temp = pt[0];
                pt[0] = h - pt[1] - 1;
                pt[1] = temp;
            }
            [w, h] = [h, w];
        }
        return pt;
    }

    rotateX90Degrees(pt: [number, number, number], by: number, h: number, d: number): [number, number, number] {
        for (let i = 0; i < Math.abs(by); i++) {
            if (by > 0) {
                const temp = pt[1];
                pt[1] = d - pt[2] - 1;
                pt[2] = temp;
            } else {
                const temp = pt[2];
                pt[2] = h - pt[1] - 1;
                pt[1] = temp;
            }
            [h, d] = [d, h];
        }
        return pt;
    }

    buildCube(): [number, number, number][] {
        let width = this.width;
        let height = this.height;
        let depth = this.depth;

        const nodes: [number, number, number][] = [];
        const strandStyle = this.getStrandStyleIndex();

        const rotation = transformations[this.calcTransformationIndex()];
        const xr = rotation[0];
        const yr = rotation[1];
        const zr = rotation[2];
        const xf = rotation[3];

        // Pre-rotate dimensions
        if (Math.abs(zr) === 1) [width, height] = [height, width];
        if (Math.abs(yr) === 1) [width, depth] = [depth, width];
        if (Math.abs(xr) === 1) [height, depth] = [depth, height];

        for (let i = 0; i < width * height * depth; i++) {
            let z = Math.floor(i / (width * height));
            const baselayer = i % (width * height);
            let y = Math.floor(baselayer / width);
            let x: number;

            if ((strandStyle === 1 || y % 2 === 0) && strandStyle !== 2) {
                x = baselayer % width;
            } else if (strandStyle === 2) {
                const pos = (baselayer % width) + 1;
                if (pos <= Math.floor((width + 1) / 2)) {
                    x = 2 * (pos - 1);
                } else {
                    x = (width - pos) * 2 + 1;
                }
            } else {
                x = width - (baselayer % width) - 1;
            }

            if (!this.strandPerLayer) {
                if (z % 2 !== 0) {
                    y = height - y - 1;
                    if (height % 2 !== 0 && strandStyle === 0) {
                        x = width - x - 1;
                    }
                }
            }

            let node: [number, number, number] = [x, y, z];
            let w = width, h = height, d = depth;

            this.rotateX90Degrees(node, xr, h, d);
            if (Math.abs(xr) === 1) [h, d] = [d, h];
            this.rotateY90Degrees(node, yr, w, d);
            if (Math.abs(yr) === 1) [w, d] = [d, w];
            this.rotateZ90Degrees(node, zr, w, h);

            if (xf > 0) this.flipX(node, this.width);

            nodes.push(node);
        }

        return nodes;
    }

    isCylinder(): boolean {
        return this.cubeShape === 1;
    }

    /**
     * Build the logical→screen coordinate function, mirroring the calcScreen
     * lambda in xLights CubeModel::InitModel().  Wiring order, strands, and
     * buffer coords are untouched by the shape — only screen/model coords
     * change between Cube and Cylinder.
     */
    private makeCalcScreen(): (lx: number, ly: number, lz: number) => [number, number, number] {
        const width = this.width;
        const height = this.height;
        const depth = this.depth;

        if (this.isCylinder()) {
            // Precomputed tables, as in C++: outer radius from circumference,
            // per-column angles, and per-depth-layer ring radii (layer 0 is
            // the outermost ring; hollowPct sets the innermost ring's radius
            // as a percentage of the outer radius).
            const twoPi = 2 * Math.PI;
            const outerRadius = width / twoPi;
            // C++ SetHollowPct clamps to 0..99
            const hollowPct = Math.min(99, Math.max(0, this.hollowPct));
            const innerFraction = hollowPct / 100;
            const cosTable: number[] = [];
            const sinTable: number[] = [];
            for (let i = 0; i < width; i++) {
                const angle = twoPi * i / width;
                cosTable.push(Math.cos(angle));
                sinTable.push(Math.sin(angle));
            }
            const ringRadTable: number[] = [];
            if (depth <= 1) {
                ringRadTable.push(outerRadius);
            } else {
                for (let i = 0; i < depth; i++) {
                    ringRadTable.push(outerRadius * (1 - (i / (depth - 1)) * (1 - innerFraction)));
                }
            }
            // Note: unlike the cube path there is no depth-flip — lz indexes
            // the ring table directly (C++ ring_rad_table[lz]).
            return (lx, ly, lz) => [
                ringRadTable[lz] * cosTable[lx],
                ly - Math.floor(height / 2),
                ringRadTable[lz] * sinTable[lx],
            ];
        }

        // Cube shape.  Odd depth layers may be nudged half a pixel in X
        // (RowOffset::Positive/Negative); any other value means None.
        const rowOffset = this.rowOffset === 1 ? 0.5 : this.rowOffset === 2 ? -0.5 : 0;
        return (lx, ly, lz) => [
            (lx - Math.floor(width / 2)) + (lz % 2 === 1 ? rowOffset : 0),
            ly - Math.floor(height / 2),
            depth - lz - 1 - Math.floor(depth / 2),
        ];
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];

        const width = this.width;
        const height = this.height;
        const depth = this.depth;
        const totalLights = width * height * depth;
        const nodeCount = this.getNumNodes();

        let logicalBufferWidth = width * depth;
        let logicalBufferHeight = height;

        const locations = this.buildCube();
        const calcScreen = this.makeCalcScreen();

        if (this.singleNode) {
            // Single node mode: one node per string, all lights as coords
            const lightsPerString = Math.floor(totalLights / this.numStrings);
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

                const startLight = n * lightsPerString;
                const endLight = (n === nodeCount - 1) ? totalLights : (n + 1) * lightsPerString;

                for (let c = startLight; c < endLight; c++) {
                    const coord = defNodeCoord();
                    // Buffer: all coords at same position for this node
                    coord.bufX = n;
                    coord.bufY = 0;

                    // Model coords follow cube/cylinder geometry
                    const loc = locations[c];
                    [coord.modelX, coord.modelY, coord.modelZ] = calcScreen(loc[0], loc[1], loc[2]);

                    nn.coords.push(coord);
                }
                nodes.push(nn);
            }
        } else {
            // Normal mode: one node per light
            for (let i = 0; i < nodeCount; ++i) {
                const nn = defNodeLoc();
                nn.coords.push(defNodeCoord());
                nodes.push(nn);
            }

            for (let n = 0; n < nodeCount; n++) {
                nodes[n].physicalNum = n;
                nodes[n].logicalNum = n;

                const loc = locations[n];
                nodes[n].coords[0].bufX = loc[0] + loc[2] * width;
                nodes[n].coords[0].bufY = loc[1];

                // Screen/model coordinates (calcScreen uses Math.floor to
                // match C++ integer division behavior)
                [nodes[n].coords[0].modelX, nodes[n].coords[0].modelY, nodes[n].coords[0].modelZ]
                    = calcScreen(loc[0], loc[1], loc[2]);

                nodes[n].logicalX = nodes[n].coords[0].bufX;
                nodes[n].logicalY = nodes[n].coords[0].bufY;
            }
        }

        // 3D world matrix (no perspective)
        const toWorldCoords = getWorldMatrixForBoxed(this);

        // 2D world matrix - cube always has depth, apply 0.1 radian perspective tilt
        // This matches C++: screenLocation.SetPerspective2D(0.1f);
        const toWorld2DCoords = getWorldMatrixForBoxed(this, 0.1);

        return {
            toWorldCoords,
            toWorld2DCoords,
            logicalBufferWidth,
            logicalBufferHeight,
            logicalBufferDepth: depth,
            nodes,
        };
    }

    getBufferDescription(ind: EffectBufferDescriptionInput) {
        const ebdo = defEffectBufferDescriptionOutput();
        return ebdo;
    }
}

export const CubeModelType: ModelType = {
    typeName: "Cube",
    displayAs: "Cube",
    modelXmlTag: 'cubemodel',
};

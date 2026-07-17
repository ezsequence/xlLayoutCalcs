import { mat4 } from "gl-matrix";
import {
    NodeLoc,
    EffectBufferDescriptionInput,
    ModelProperty,
    ModelType,
    GetNodeResult,
} from "./modelbase";
import { defEffectBufferDescriptionOutput } from "./modelshared";
import { defNodeCoord } from "./modelshared";
import { defNodeLoc } from "./modelshared";
import { BaseModelClass } from "./modelshared";

interface PolyPoint {
    x: number;
    y: number;
    z: number;
    length?: number;
    hasCurve?: boolean;
    curve?: BezierCurve;
}

// Cubic Bezier curve class - matches xLights C++ BezierCurveCubic3D implementation
class BezierCurve {
    p0: [number, number, number];  // start point
    p1: [number, number, number];  // end point
    cp0: [number, number, number]; // control point 0
    cp1: [number, number, number]; // control point 1
    private steps: number = 25;    // Must match C++ (steps=25 gives 26 points)
    private points: [number, number, number][] = [];
    private segmentLengths: number[] = [];
    private totalLength: number = 0;

    constructor(
        p0: [number, number, number],
        p1: [number, number, number],
        cp0: [number, number, number],
        cp1: [number, number, number]
    ) {
        this.p0 = p0;
        this.p1 = p1;
        this.cp0 = cp0;
        this.cp1 = cp1;
        this.updatePoints();
        this.updateLengths();
    }

    // Linear interpolation helper (matches C++ interpPt)
    private interpPt(n1: number, n2: number, perc: number): number {
        return n1 + (n2 - n1) * perc;
    }

    // Pre-calculate curve points using De Casteljau's algorithm (matches C++ UpdatePoints)
    private updatePoints(): void {
        this.points = [];

        for (let i = 0; i < this.steps; i++) {
            const t = i / this.steps;

            // Control Line Segments
            const xa = this.interpPt(this.p0[0], this.cp0[0], t);
            const ya = this.interpPt(this.p0[1], this.cp0[1], t);
            const za = this.interpPt(this.p0[2], this.cp0[2], t);
            const xb = this.interpPt(this.cp0[0], this.cp1[0], t);
            const yb = this.interpPt(this.cp0[1], this.cp1[1], t);
            const zb = this.interpPt(this.cp0[2], this.cp1[2], t);
            const xc = this.interpPt(this.cp1[0], this.p1[0], t);
            const yc = this.interpPt(this.cp1[1], this.p1[1], t);
            const zc = this.interpPt(this.cp1[2], this.p1[2], t);

            // Between Control Lines
            const xd = this.interpPt(xa, xb, t);
            const yd = this.interpPt(ya, yb, t);
            const zd = this.interpPt(za, zb, t);
            const xe = this.interpPt(xb, xc, t);
            const ye = this.interpPt(yb, yc, t);
            const ze = this.interpPt(zb, zc, t);

            // The curve point
            const x = this.interpPt(xd, xe, t);
            const y = this.interpPt(yd, ye, t);
            const z = this.interpPt(zd, ze, t);

            this.points.push([x, y, z]);
        }

        // Add final point (p1)
        this.points.push([this.p1[0], this.p1[1], this.p1[2]]);
    }

    // Calculate segment lengths between pre-calculated points (matches C++ UpdateMatrices)
    private updateLengths(): void {
        this.segmentLengths = [];
        this.totalLength = 0;

        for (let i = 0; i < this.points.length - 1; i++) {
            const dx = this.points[i + 1][0] - this.points[i][0];
            const dy = this.points[i + 1][1] - this.points[i][1];
            const dz = this.points[i + 1][2] - this.points[i][2];
            const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
            this.segmentLengths.push(len);
            this.totalLength += len;
        }
    }

    getLength(): number {
        return this.totalLength;
    }

    // Get number of pre-calculated points
    getNumPoints(): number {
        return this.points.length;
    }

    // Get a pre-calculated point by index
    getPoint(index: number): [number, number, number] {
        if (index < 0) return this.points[0];
        if (index >= this.points.length) return this.points[this.points.length - 1];
        return this.points[index];
    }

    // Get point at a parametric t value (0 to 1) using pre-calculated points
    getPointAtT(t: number): [number, number, number] {
        if (t <= 0) return this.points[0];
        if (t >= 1) return this.points[this.points.length - 1];
        // Find the segment and interpolate
        const idx = t * this.steps;
        const i = Math.floor(idx);
        const frac = idx - i;
        if (i >= this.points.length - 1) return this.points[this.points.length - 1];
        return [
            this.points[i][0] + frac * (this.points[i + 1][0] - this.points[i][0]),
            this.points[i][1] + frac * (this.points[i + 1][1] - this.points[i][1]),
            this.points[i][2] + frac * (this.points[i + 1][2] - this.points[i][2])
        ];
    }

    // Get point at a specific distance - LINEAR INTERPOLATION between pre-calculated points
    // This matches C++ behavior which does NOT re-evaluate the Bezier formula
    getPointAtDistance(distance: number): [number, number, number] {
        if (distance <= 0) return this.points[0];
        if (distance >= this.totalLength) return this.points[this.points.length - 1];

        let accumulated = 0;
        for (let i = 0; i < this.segmentLengths.length; i++) {
            if (accumulated + this.segmentLengths[i] >= distance) {
                // Linear interpolation between pre-calculated points[i] and points[i+1]
                const segProgress = (distance - accumulated) / this.segmentLengths[i];
                return [
                    this.points[i][0] + segProgress * (this.points[i + 1][0] - this.points[i][0]),
                    this.points[i][1] + segProgress * (this.points[i + 1][1] - this.points[i][1]),
                    this.points[i][2] + segProgress * (this.points[i + 1][2] - this.points[i][2])
                ];
            }
            accumulated += this.segmentLengths[i];
        }
        return this.points[this.points.length - 1];
    }
}

const polyLineProperties: ModelProperty[] = [
    // In old-format files parm1 is a vestigial constant "1"; keep
    // the binding so it's consumed without an unused-attribute warning.
    {name: 'PolyLineParm1', ptype: "INTEGER", fieldName: 'parm1', xmlName: 'parm1', description: "Parameter 1 (vestigial, old format only)"},
    {name: 'PolyLineNumPoints', ptype: "INTEGER", fieldName: 'numPoints', xmlName: 'NumPoints', description: "# Points"},
    {name: 'PolyLineLights', ptype: "INTEGER", fieldName: 'numLights', xmlName: 'NodesPerString', description: "# Lights"},
    {name: 'PolyLineLightsPerNode', ptype: "INTEGER", fieldName: 'lightsPerNode', xmlName: 'LightsPerNode', description: "Lights Per Node"},
    {name: 'PointData', ptype: "STRING", fieldName: 'pointData', xmlName: 'PointData', description: "Point Data"},
    {name: 'cPointData', ptype: "STRING", fieldName: 'cPointData', xmlName: 'cPointData', description: "Curve Point Data"},
    // Note: no IndivSegs binding — the normalizer strips the fork's explicit
    // flag; createModelFromXml derives hasIndivSeg from Seg1 presence, the
    // implicit encoding both canonical-format xLights and this engine use.
    {name: 'SegsExpanded', ptype: "STRING", fieldName: 'segsExpanded', xmlName: 'SegsExpanded', description: "Segments Expanded State"},
    {name: 'SegsCollapsed', ptype: "STRING", fieldName: 'segsCollapsed', xmlName: 'SegsCollapsed', description: "Segments Collapsed State"},
    {name: 'DropPattern', ptype: "STRING", fieldName: 'dropPattern', xmlName: 'DropPattern', description: "Drop Pattern"},
    {name: 'AlternateNodes', ptype: "BOOL", fieldName: 'alternateNodes', xmlName: 'AlternateNodes', description: "Alternate Nodes"},
    {name: 'PolyStrings', ptype: "INTEGER", fieldName: 'polyStrings', xmlName: 'PolyStrings', description: "# Strings"},
    // Note: PolyNode1, PolyNode2, ... PolyNodeN are dynamic properties parsed based on PolyStrings
    {name: 'Dir', ptype: "STRING", fieldName: 'dir', xmlName: 'Dir', description: "Direction L/R"},
    {name: 'ModelHeight', ptype: "FLOAT", fieldName: 'modelHeight', xmlName: 'ModelHeight', description: "Model Height"},
    // Note: Seg1, Seg2, ... SegN and Corner1, Corner2, ... CornerN+1 are dynamic properties
    // They are parsed separately based on NumPoints
];

export class PolyLineModel extends BaseModelClass {
    modelType: ModelType = PolyLineModelType;
    parm1: number = 1;
    numPoints: number = 2;
    numLights: number = 50;
    lightsPerNode: number = 1;
    polyStrings: number = 1;
    singleNode: boolean = false;
    pointData: string = "0.0, 0.0, 0.0, 1.0, 0.0, 0.0";
    cPointData: string = "";
    hasIndivSeg: boolean = false;
    segsExpanded: string = "";  // UI state: "TRUE" or "FALSE"
    segsCollapsed: string = "";  // UI state: "TRUE" or "FALSE"
    dropPattern: string = "1";
    alternateNodes: boolean = false;
    dir: string = "L";
    modelHeight: number = 1.0;

    // Dynamic segment sizes for individual segments mode (Seg1, Seg2, etc.)
    // Key is segment index (0-based), value is number of drops in that segment
    segmentSizes: Map<number, number> = new Map();

    // Dynamic corner settings (Corner1, Corner2, etc.)
    // Key is corner index (0-based), value is "Leading Segment", "Trailing Segment", or "Neither"
    cornerSettings: Map<number, string> = new Map();

    // Dynamic node counts per string (PolyNode1, PolyNode2, etc.)
    // Key is string index (0-based), value is node count for that string
    polyNodeCounts: Map<number, number> = new Map();

    constructor() {super();}

    getType(): string {
        return "Polyline";
    }

    getProperties(): ModelProperty[] {
        return polyLineProperties;
    }

    getNumNodes() {
        if (this.singleNode) {
            return this.polyStrings;  // One node per string in single node mode
        }
        return this.numLights;
    }

    parseDropPattern(): number[] {
        const sizes: number[] = [];
        const parts = this.dropPattern.split(',');
        for (const part of parts) {
            const d = parseInt(part.trim());
            if (!isNaN(d) && d !== 0) {
                sizes.push(d);
            }
        }
        if (sizes.length === 0) {
            sizes.push(1);
        }
        return sizes;
    }

    parsePointData(): PolyPoint[] {
        const points: PolyPoint[] = [];
        const values = this.pointData.split(',').map(v => parseFloat(v.trim()));

        for (let i = 0; i + 2 < values.length; i += 3) {
            points.push({
                x: values[i] || 0,
                y: values[i + 1] || 0,
                z: values[i + 2] || 0,
                hasCurve: false
            });
        }

        // Ensure we have at least 2 points
        while (points.length < 2) {
            points.push({ x: points.length, y: 0, z: 0, hasCurve: false });
        }

        // Parse curve data if present
        // Format: seg_num,cp0_x,cp0_y,cp0_z,cp1_x,cp1_y,cp1_z;...
        if (this.cPointData && this.cPointData.trim() !== "") {
            const curveValues = this.cPointData.split(',').map(v => parseFloat(v.trim()));
            const numCurves = Math.floor(curveValues.length / 7);

            for (let i = 0; i < numCurves; i++) {
                const segNum = Math.floor(curveValues[i * 7]);
                if (segNum >= 0 && segNum < points.length - 1) {
                    const cp0: [number, number, number] = [
                        curveValues[i * 7 + 1],
                        curveValues[i * 7 + 2],
                        curveValues[i * 7 + 3]
                    ];
                    const cp1: [number, number, number] = [
                        curveValues[i * 7 + 4],
                        curveValues[i * 7 + 5],
                        curveValues[i * 7 + 6]
                    ];

                    points[segNum].hasCurve = true;
                    points[segNum].curve = new BezierCurve(
                        [points[segNum].x, points[segNum].y, points[segNum].z],
                        [points[segNum + 1].x, points[segNum + 1].y, points[segNum + 1].z],
                        cp0,
                        cp1
                    );
                }
            }
        }

        return points;
    }

    getNodeCoords(): GetNodeResult {
        const nodes: NodeLoc[] = [];
        const isLtoR = this.dir === 'L';

        const dropSizes = this.parseDropPattern();
        const pPos = this.parsePointData();

        const numPoints = pPos.length;
        const numSegments = numPoints - 1;

        // Calculate total length and segment lengths
        let totalLength = 0;
        for (let i = 0; i < numSegments; i++) {
            const curve = pPos[i].curve;
            if (pPos[i].hasCurve && curve) {
                pPos[i].length = curve.getLength();
            } else {
                const dx = pPos[i + 1].x - pPos[i].x;
                const dy = pPos[i + 1].y - pPos[i].y;
                const dz = pPos[i + 1].z - pPos[i].z;
                pPos[i].length = Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
            totalLength += pPos[i].length!;
        }

        // Find max drop size for buffer height
        let maxH = 0;
        for (const d of dropSizes) {
            maxH = Math.max(maxH, Math.abs(d));
        }
        const usingIcicles = maxH > 1;

        // Calculate number of drop points
        let numDropPoints = 0;
        let dropIndex = 0;
        let lights = this.numLights;
        while (lights > 0) {
            const lightsThisDrop = Math.abs(dropSizes[dropIndex]);
            numDropPoints++;
            lights -= lightsThisDrop;
            dropIndex = (dropIndex + 1) % dropSizes.length;
        }

        // Create nodes
        const nodeCount = this.getNumNodes();
        if (this.singleNode) {
            // Single node mode: one node per string, all lights as coords
            const lightsPerString = Math.floor(this.numLights / this.polyStrings);
            for (let n = 0; n < nodeCount; n++) {
                const nn = defNodeLoc();
                // For channel assignment: Dir="R" means wiring starts from right end
                nn.physicalNum = isLtoR ? n : (nodeCount - 1 - n);
                nn.physicalStrand = n;
                nn.logicalNum = n;
                const numCoordsThisNode = (n === nodeCount - 1)
                    ? this.numLights - (lightsPerString * n)  // Last node gets remainder
                    : lightsPerString;
                for (let c = 0; c < numCoordsThisNode; c++) {
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

        // Calculate min/max for normalization (including curve control points)
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const p of pPos) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            minZ = Math.min(minZ, p.z);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
            maxZ = Math.max(maxZ, p.z);
            // Also check curve extents using pre-calculated points
            if (p.hasCurve && p.curve) {
                const numPts = p.curve.getNumPoints();
                for (let i = 0; i < numPts; i++) {
                    const pt = p.curve.getPoint(i);
                    minX = Math.min(minX, pt[0]);
                    minY = Math.min(minY, pt[1]);
                    minZ = Math.min(minZ, pt[2]);
                    maxX = Math.max(maxX, pt[0]);
                    maxY = Math.max(maxY, pt[1]);
                    maxZ = Math.max(maxZ, pt[2]);
                }
            }
        }

        const deltaX = maxX - minX || 1;
        const deltaY = maxY - minY || 1;
        const deltaZ = maxZ - minZ || 1;

        // Calculate icicle height scaling
        // C++ uses: screenY = v.y + (z + c*coord_offset) * mheight
        // mheight is modelHeight * 10.0 (drop spacing in world units)
        const dropSpacing = this.modelHeight * 10.0;

        // Distribute lights along the polyline with icicle drops
        dropIndex = 0;
        let curNode = 0;
        let curCoord = 0;
        let width = 0;
        let y = 0;
        let nodesInDrop = Math.abs(dropSizes[dropIndex]);
        let up = dropSizes[dropIndex] < 0;

        // Calculate buffer positions
        if (this.singleNode) {
            // Single node mode: all coords at same buffer position per node
            for (let n = 0; n < nodeCount; n++) {
                nodes[n].logicalX = 0;
                nodes[n].logicalY = 0;
                for (let c = 0; c < nodes[n].coords.length; c++) {
                    nodes[n].coords[c].bufX = 0;
                    nodes[n].coords[c].bufY = 0;
                }
            }
        } else {
            // For Dir="R", we need to reverse drop order but keep position within drop
            // First pass: count total drops and nodes per drop (y increments once per node)
            let tempY = 0;
            let tempDropIndex = 0;
            let totalDrops = 0;
            const dropNodeCounts: number[] = [];  // Number of nodes in each drop
            let nodesInCurrentDrop = 0;

            for (let n = 0; n < nodeCount; n++) {
                while (tempY >= Math.abs(dropSizes[tempDropIndex])) {
                    dropNodeCounts.push(nodesInCurrentDrop);
                    nodesInCurrentDrop = 0;
                    totalDrops++;
                    tempY = 0;
                    tempDropIndex = (tempDropIndex + 1) % dropSizes.length;
                }
                nodesInCurrentDrop++;
                tempY++;
            }
            if (nodesInCurrentDrop > 0) {
                dropNodeCounts.push(nodesInCurrentDrop);
                totalDrops++;
            }

            // Calculate starting node index for each drop when reversed
            // For Dir="R", we want visual drop 0 to get the LAST physical channels
            // So we calculate where each visual drop would start if drops were placed right-to-left
            const reversedDropStarts: number[] = new Array(totalDrops);
            let sumFromEnd = 0;
            for (let d = totalDrops - 1; d >= 0; d--) {
                reversedDropStarts[d] = sumFromEnd;
                sumFromEnd += dropNodeCounts[d];
            }

            lights = nodeCount * this.lightsPerNode;
            let currentDrop = 0;
            let posInDrop = 0;

            while (lights > 0 && curNode < nodeCount) {
                if (curCoord >= nodes[curNode].coords.length) {
                    curNode++;
                    curCoord = 0;
                }
                if (curNode >= nodeCount) break;

                while (y >= Math.abs(dropSizes[dropIndex])) {
                    width++;
                    currentDrop++;
                    posInDrop = 0;
                    y = 0;
                    dropIndex = (dropIndex + 1) % dropSizes.length;
                    nodesInDrop = Math.abs(dropSizes[dropIndex]);
                    up = dropSizes[dropIndex] < 0;
                }

                // For channel assignment: Dir="R" means drop order is reversed
                // but position within each drop stays the same
                // reversedDropStarts[d] = where visual drop d starts when placed in reverse order
                if (isLtoR) {
                    nodes[curNode].physicalNum = curNode;
                } else {
                    nodes[curNode].physicalNum = reversedDropStarts[currentDrop] + posInDrop;
                }
                nodes[curNode].logicalNum = curNode;
                nodes[curNode].coords[curCoord].bufX = width;

                if (this.alternateNodes) {
                    if (y + 1 <= Math.floor((nodesInDrop + 1) / 2)) {
                        nodes[curNode].coords[curCoord].bufY = up ? 2 * y : maxH - 1 - (2 * y);
                    } else {
                        const altY = (nodesInDrop - (y + 1)) * 2 + 1;
                        nodes[curNode].coords[curCoord].bufY = up ? altY : maxH - 1 - altY;
                    }
                } else {
                    nodes[curNode].coords[curCoord].bufY = up ? y : maxH - y - 1;
                }

                lights--;
                curCoord++;
                if (curCoord === this.lightsPerNode) {
                    y++;
                    posInDrop++;
                }
            }
        }

        // Set logical positions
        for (const node of nodes) {
            if (node.coords.length > 0) {
                node.logicalX = node.coords[0].bufX;
                node.logicalY = node.coords[0].bufY;
            }
        }

        // Distribute model coordinates evenly along polyline with icicle drop offsets
        // PolyLine uses PolyPointScreenLocation in C++ - the PointData IS the world shape
        if (totalLength > 0 && numDropPoints > 0) {
            const coordsPerNode = this.lightsPerNode;
            // C++: coord_offset = using_icicles ? 1.0f / (float)coords_per_node : 0.0f
            const coordOffset = usingIcicles ? 1.0 / coordsPerNode : 0.0;

            // Helper function to get position at a distance within a specific segment
            const getPositionInSegment = (segIndex: number, distance: number): [number, number, number] => {
                const segLen = pPos[segIndex].length || 0;
                const clampedDist = Math.max(0, Math.min(distance, segLen));
                const t = segLen > 0 ? clampedDist / segLen : 0;
                const segCurve = pPos[segIndex].curve;
                if (pPos[segIndex].hasCurve && segCurve) {
                    // Use arc-length parameterization for curves
                    return segCurve.getPointAtDistance(clampedDist);
                } else {
                    return [
                        pPos[segIndex].x + t * (pPos[segIndex + 1].x - pPos[segIndex].x),
                        pPos[segIndex].y + t * (pPos[segIndex + 1].y - pPos[segIndex].y),
                        pPos[segIndex].z + t * (pPos[segIndex + 1].z - pPos[segIndex].z)
                    ];
                }
            };

            // Helper function to get position at a distance along the entire polyline
            const getPositionAtDistance = (distance: number): [number, number, number] => {
                let remaining = Math.max(0, Math.min(distance, totalLength));
                for (let seg = 0; seg < numSegments; seg++) {
                    const segLen = pPos[seg].length || 0;
                    if (remaining <= segLen || seg === numSegments - 1) {
                        return getPositionInSegment(seg, remaining);
                    }
                    remaining -= segLen;
                }
                // Fallback to last point
                const lastPt = pPos[numSegments] || pPos[numSegments - 1];
                return [lastPt.x, lastPt.y, lastPt.z];
            };

            // Helper to apply icicle drop offset
            // Icicle buffers are upside down: bufY=0 is at the tip, bufY=maxH-1 at main line
            // For non-up drops: Y decreases from py as dropY increases (drops go down)
            // For up drops: Y increases from py as dropY increases (drops go up)
            const applyDropOffset = (py: number, dropY: number, c: number, nodesInDrop: number, up: boolean): number => {
                if (!usingIcicles) return py;
                const zOffset = dropY + (c * coordOffset);
                let dropOffset: number;
                if (this.alternateNodes) {
                    if (dropY + 1 <= Math.floor((nodesInDrop + 1) / 2)) {
                        dropOffset = up ? (2 * zOffset) : -(2 * zOffset);
                    } else {
                        const altY = (nodesInDrop - (dropY + 1)) * 2 + 1;
                        dropOffset = up ? (altY + (c * coordOffset)) : -(altY + (c * coordOffset));
                    }
                } else {
                    // Normal drops: Y decreases (negative offset)
                    // Up drops: Y increases (positive offset)
                    dropOffset = up ? zOffset : -zOffset;
                }
                return py + dropOffset * dropSpacing;
            };

            dropIndex = 0;
            let dropY = 0;
            up = dropSizes[dropIndex] < 0;
            nodesInDrop = Math.abs(dropSizes[dropIndex]);
            let curNode = 0;

            if (this.hasIndivSeg) {
                // Individual segments mode: each segment has its own node count
                if (this.singleNode) {
                    // Single node mode: one node with all coords distributed along segments
                    let coordIdx = 0;
                    for (let seg = 0; seg < numSegments; seg++) {
                        const segLen = pPos[seg].length || 0;
                        const segDropCount = this.segmentSizes.get(seg) || 0;
                        if (segDropCount <= 0 || segLen <= 0) continue;

                        const startCorner = this.cornerSettings.get(seg) || "Neither";
                        const endCorner = this.cornerSettings.get(seg + 1) || "Neither";

                        let startFraction = 0, endFraction = 0;
                        if (startCorner === "Leading Segment") startFraction = 1.0;
                        else if (startCorner === "Neither") startFraction = 0.5;
                        if (endCorner === "Trailing Segment") endFraction = 1.0;
                        else if (endCorner === "Neither") endFraction = 0.5;

                        const totalUnits = (segDropCount - 1) + startFraction + endFraction;
                        const segOffset = totalUnits > 0 ? segLen / totalUnits : 0;
                        const startDist = startFraction * segOffset;

                        for (let dropInSeg = 0; dropInSeg < segDropCount; dropInSeg++) {
                            const distInSeg = startDist + dropInSeg * segOffset;
                            const [x, py, z] = getPositionInSegment(seg, distInSeg);

                            // Place coords at this drop position
                            for (let nodeInDrop = 0; nodeInDrop < nodesInDrop && coordIdx < nodes[0].coords.length; nodeInDrop++) {
                                nodes[0].coords[coordIdx].modelX = x;
                                nodes[0].coords[coordIdx].modelY = applyDropOffset(py, nodeInDrop, 0, nodesInDrop, up);
                                nodes[0].coords[coordIdx].modelZ = z;
                                coordIdx++;
                            }

                            dropIndex = (dropIndex + 1) % dropSizes.length;
                            nodesInDrop = Math.abs(dropSizes[dropIndex]);
                            up = dropSizes[dropIndex] < 0;
                        }
                    }
                } else {
                    // Normal mode: distribute nodes along segments
                    for (let seg = 0; seg < numSegments && curNode < nodeCount; seg++) {
                        const segLen = pPos[seg].length || 0;
                        // Get drop count for this segment from segmentSizes (0-indexed)
                        const segDropCount = this.segmentSizes.get(seg) || 0;
                        if (segDropCount <= 0 || segLen <= 0) continue;

                        // Get corner settings for this segment
                        // Corner N is at start of segment N, Corner N+1 is at end of segment N
                        const startCorner = this.cornerSettings.get(seg) || "Neither";
                        const endCorner = this.cornerSettings.get(seg + 1) || "Neither";

                        // Determine corner behavior:
                        // "Trailing Segment": corner belongs to trailing segment (this seg includes it at start)
                        // "Leading Segment": corner belongs to leading segment (this seg includes it at end)
                        // "Neither": corner is split - offset by half from the corner point

                        // Calculate effective length considering "Neither" corners take half-offset from each side
                        // Start offset: 0 for Trailing, half for Neither, full for Leading
                        // End offset: 0 for Leading, half for Neither, full for Trailing
                        let startFraction = 0;  // fraction of offset to apply at start
                        let endFraction = 0;    // fraction of offset to apply at end

                        if (startCorner === "Leading Segment") {
                            startFraction = 1.0;  // full offset - leading segment owns it
                        } else if (startCorner === "Neither") {
                            startFraction = 0.5;  // half offset - split with previous segment
                        }
                        // "Trailing Segment" = 0 - we own it, start at corner

                        if (endCorner === "Trailing Segment") {
                            endFraction = 1.0;    // full offset - trailing segment owns it
                        } else if (endCorner === "Neither") {
                            endFraction = 0.5;    // half offset - split with next segment
                        }
                        // "Leading Segment" = 0 - we own it, end at corner

                        // Effective length after accounting for corner offsets
                        // We have segDropCount nodes to place
                        // Total "units" = segDropCount - 1 intervals + startFraction + endFraction
                        const totalUnits = (segDropCount - 1) + startFraction + endFraction;
                        const segOffset = totalUnits > 0 ? segLen / totalUnits : 0;

                        // Starting distance
                        const startDist = startFraction * segOffset;

                        // Distribute nodes within this segment
                        // segDropCount is the number of DROP POSITIONS in this segment
                        // At each drop position, we place nodesInDrop NODES (from drop pattern)
                        for (let dropInSeg = 0; dropInSeg < segDropCount && curNode < nodeCount; dropInSeg++) {
                            const distInSeg = startDist + dropInSeg * segOffset;
                            const [x, py, z] = getPositionInSegment(seg, distInSeg);

                            // Place all nodes at this drop position
                            for (let nodeInDrop = 0; nodeInDrop < nodesInDrop && curNode < nodeCount; nodeInDrop++) {
                                // All coords in a node are at the same position along the curve
                                // coordOffset spreads them vertically within the drop
                                const coordCount = nodes[curNode].coords.length;
                                for (let c = 0; c < coordCount; c++) {
                                    nodes[curNode].coords[c].modelX = x;
                                    nodes[curNode].coords[c].modelY = applyDropOffset(py, nodeInDrop, c, nodesInDrop, up);
                                    nodes[curNode].coords[c].modelZ = z;
                                }
                                curNode++;
                            }

                            // After placing all nodes at this drop position, advance to next drop size in pattern
                            dropIndex = (dropIndex + 1) % dropSizes.length;
                            nodesInDrop = Math.abs(dropSizes[dropIndex]);
                            up = dropSizes[dropIndex] < 0;
                        }
                    }
                }
            } else {
                // Standard mode: distribute all nodes evenly along entire polyline
                // C++ places first light at 0, last light at totalLength - offset
                let offset: number;
                if (this.singleNode) {
                    offset = totalLength / numDropPoints;
                } else {
                    offset = totalLength / (numDropPoints * (usingIcicles ? 1.0 : coordsPerNode));
                }

                let currentDropPoint = 0;

                for (let n = 0; n < nodeCount; n++) {
                    const coordCount = nodes[n].coords.length;

                    if (usingIcicles) {
                        // Icicles mode: all coords in a node at same position along curve,
                        // with vertical spread via coordOffset
                        const currentPos = currentDropPoint * offset;
                        const [x, py, z] = getPositionAtDistance(currentPos);

                        for (let c = 0; c < coordCount; c++) {
                            nodes[n].coords[c].modelX = x;
                            nodes[n].coords[c].modelY = applyDropOffset(py, dropY, c, nodesInDrop, up);
                            nodes[n].coords[c].modelZ = z;
                        }

                        // Advance drop pattern once per node
                        dropY++;
                        if (dropY >= Math.abs(dropSizes[dropIndex])) {
                            dropY = 0;
                            dropIndex = (dropIndex + 1) % dropSizes.length;
                            up = dropSizes[dropIndex] < 0;
                            nodesInDrop = Math.abs(dropSizes[dropIndex]);
                            currentDropPoint++;
                        }
                    } else {
                        // No icicles: each coord advances along the polyline
                        for (let c = 0; c < coordCount; c++) {
                            const currentPos = currentDropPoint * offset;
                            const [x, py, z] = getPositionAtDistance(currentPos);

                            nodes[n].coords[c].modelX = x;
                            nodes[n].coords[c].modelY = py;
                            nodes[n].coords[c].modelZ = z;

                            currentDropPoint++;
                        }
                    }
                }
            }
        } else {
            // Fallback: distribute nodes linearly between first and last point
            const startX = pPos.length > 0 ? pPos[0].x : 0;
            const startY = pPos.length > 0 ? pPos[0].y : 0;
            const startZ = pPos.length > 0 ? pPos[0].z : 0;
            const endX = pPos.length > 1 ? pPos[pPos.length - 1].x : startX + 1;
            const endY = pPos.length > 1 ? pPos[pPos.length - 1].y : startY;
            const endZ = pPos.length > 1 ? pPos[pPos.length - 1].z : startZ;

            for (let n = 0; n < nodeCount; n++) {
                const coordCount = nodes[n].coords.length;
                const t = nodeCount > 1 ? n / (nodeCount - 1) : 0.5;
                for (let c = 0; c < coordCount; c++) {
                    nodes[n].coords[c].modelX = startX + t * (endX - startX);
                    nodes[n].coords[c].modelY = startY + t * (endY - startY);
                    nodes[n].coords[c].modelZ = startZ + t * (endZ - startZ);
                }
            }
        }

        const logicalBufferWidth = this.singleNode ? 1 : width + 1;
        const logicalBufferHeight = maxH;

        // Normalize model coordinates to 0-1 range (matching C++ PolyPointScreenLocation)
        for (const node of nodes) {
            for (const cd of node.coords) {
                cd.modelX = deltaX !== 0 ? (cd.modelX - minX) / deltaX : 0;
                cd.modelY = deltaY !== 0 ? (cd.modelY - minY) / deltaY : 0;
                cd.modelZ = deltaZ !== 0 ? (cd.modelZ - minZ) / deltaZ : 0;
            }
        }

        // For PolyLine, C++ uses PolyPointScreenLocation which applies:
        // scalingMatrix = scale by ((maxX - minX) * scalex, yscale, (maxZ - minZ) * scalez)
        // TranslateMatrix = translate by (minX * scalex + worldPos_x, ...)
        // main_matrix = TranslateMatrix * scalingMatrix
        //
        // Model coordinates are normalized to 0-1 range, so we scale by extent * scaleX/Y/Z
        // and translate by minX * scaleX + worldPosX, etc.
        const sx = this.scaleX;
        const sy = this.scaleY;
        const sz = this.scaleZ;

        const toWorldCoords = mat4.create();
        // Scale by extent * scale (since model coords are normalized 0-1)
        const scalingMatrix = mat4.create();
        mat4.scale(scalingMatrix, mat4.create(), [deltaX * sx, deltaY * sy, deltaZ * sz]);

        // Translate by min * scale + worldPos
        const translateMatrix = mat4.create();
        mat4.translate(translateMatrix, mat4.create(), [
            minX * sx + this.worldPosX,
            minY * sy + this.worldPosY,
            minZ * sz + this.worldPosZ
        ]);

        // Combine: translate * scale
        mat4.multiply(toWorldCoords, translateMatrix, scalingMatrix);

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

export const PolyLineModelType: ModelType = {
    typeName: "Poly Line",
    displayAs: "Poly Line",
    modelXmlTag: 'polylinemodel',
};

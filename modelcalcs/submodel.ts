// Submodels (port of xLights SubModel::Setup): a named subset of a model's
// nodes with its own render buffer.
//   type="ranges": each lineN is one buffer row (horizontal) or column
//     (vertical) of node numbers/ranges; "0" is a gap, a descending range runs
//     backwards, a node repeated across lines gets another coord. "Keep XY"
//     keeps the parent's buffer coords instead, shifted to the origin.
//   type="subbuffer": the parent's nodes inside a percentage box of its buffer.
// Node order and coords must match the C++: group buffers depend on them.
import type { GetNodeResult } from "./modelbase";

export interface SubModelDef {
    name: string;
    isRanges: boolean;
    vertical: boolean;
    bufferStyle: string;
    lines: string[];      // lineN attributes in order
    subBuffer: string;    // subBuffer attribute (subbuffer type)
}

export interface SubModelCoord { bufX: number; bufY: number; }

export interface SubModelNode {
    parentIndex: number;          // index into the parent GetNodeResult.nodes
    coords: SubModelCoord[];      // buffer cells this node lights, first = primary
}

export interface SubModelResult {
    def: SubModelDef;
    nodes: SubModelNode[];        // submodel node order (SubModel::Nodes)
    bufferWi: number;
    bufferHt: number;
    startChannel: number | null;  // lowest parent node channel, 0-based
    nodesAllValid: boolean;       // false when a line names a node the parent lacks
    sameLineDuplicates: number[]; // 1-based node numbers repeated within a line
    crossLineDuplicates: number[];// 1-based node numbers repeated across lines
}

export const KEEP_XY = "Keep XY";
export const STACKED_STRANDS = "Stacked Strands";

// xmldom returns '' for a missing attribute, so test presence explicitly
function attr(el: Element, name: string, def: string): string {
    return el.hasAttribute(name) ? el.getAttribute(name)! : def;
}

/** The <subModel> children of a <model> element, in document order. */
export function parseSubModelDefs(modelEl: Element): SubModelDef[] {
    const defs: SubModelDef[] = [];
    const children = modelEl.childNodes;
    for (let i = 0; i < children.length; ++i) {
        const c = children[i];
        if (c.nodeType !== 1 || (c as Element).tagName !== 'subModel') continue;
        const el = c as Element;
        const lines: string[] = [];
        for (let n = 0; ; ++n) {
            if (!el.hasAttribute(`line${n}`)) break;
            lines.push(el.getAttribute(`line${n}`)!);
        }
        defs.push({
            name: attr(el, 'name', '').trim(),
            isRanges: attr(el, 'type', 'ranges') === 'ranges',
            vertical: attr(el, 'layout', 'vertical') === 'vertical',
            bufferStyle: attr(el, 'bufferstyle', 'Default'),
            lines,
            subBuffer: attr(el, 'subBuffer', ''),
        });
    }
    return defs;
}

// getRange: "a-b" or "a"; strtol semantics (leading digits, else 0)
function parseRange(s: string): [number, number] {
    const pos = s.indexOf('-');
    if (pos >= 0) return [toInt(s.slice(0, pos)), toInt(s.slice(pos + 1))];
    const v = toInt(s);
    return [v, v];
}
function toInt(s: string): number {
    const m = /^\s*[-+]?\d+/.exec(s);
    return m ? parseInt(m[0], 10) : 0;
}

function parentChannel(parent: GetNodeResult, idx: number): number | null {
    const ch = parent.nodes[idx]?.channel;
    return ch === undefined ? null : ch;
}

function minChannel(a: number | null, b: number | null): number | null {
    if (a === null) return b;
    if (b === null) return a;
    return Math.min(a, b);
}

/** Build a submodel's nodes and buffer over its parent's node result. */
export function buildSubModel(parent: GetNodeResult, def: SubModelDef): SubModelResult {
    const nodes: SubModelNode[] = [];
    const nodeIndexMap = new Map<number, number>(); // parent index -> submodel node index
    const nodeIndexes: number[] = [];               // line walk with -1 separators (duplicate check)
    let startChannel: number | null = null;
    let nodesAllValid = true;
    let bufferWi = 1, bufferHt = 1;
    const parentCount = parent.nodes.length;

    if (def.isRanges && def.bufferStyle === KEEP_XY) {
        // initRangeXY: a sorted set of indexes; CalcRangeXYBufferSize keeps parent coords
        const idxSet = new Set<number>();
        for (const line of def.lines) {
            for (const valstr of line.split(',')) {
                let [start, end] = parseRange(valstr);
                if (start !== 0) {
                    if (start > end) [start, end] = [end, start];
                    for (let i = start - 1; i <= end - 1; ++i) { idxSet.add(i); nodeIndexes.push(i); }
                }
            }
            nodeIndexes.push(-1);
        }
        const sorted = [...idxSet].sort((a, b) => a - b);
        let minx = 10000, maxx = -1, miny = 10000, maxy = -1;
        for (const idx of sorted) {
            if (idx < parentCount) {
                for (const c of parent.nodes[idx].coords) {
                    if (c.bufX < minx) minx = c.bufX;
                    if (c.bufY < miny) miny = c.bufY;
                    if (c.bufX > maxx) maxx = c.bufX;
                    if (c.bufY > maxy) maxy = c.bufY;
                }
            }
        }
        for (const idx of sorted) {
            if (idx < parentCount) {
                startChannel = minChannel(startChannel, parentChannel(parent, idx));
                nodeIndexMap.set(idx, nodes.length);
                nodes.push({ parentIndex: idx, coords: parent.nodes[idx].coords.map(c => ({ bufX: c.bufX - minx, bufY: c.bufY - miny })) });
            }
        }
        if (maxx < minx || maxy < miny || nodes.length === 0) {
            bufferWi = 1; bufferHt = 1;
        } else {
            bufferWi = Math.ceil(maxx - minx) + 1;
            bufferHt = Math.ceil(maxy - miny) + 1;
        }
    } else if (def.isRanges) {
        // initDefaultBuffer, once per line
        let row = 0, col = 0, maxRow = 0, maxCol = 0;
        for (const line of def.lines) {
            for (const valstr of line.split(',')) {
                const [start, end] = parseRange(valstr);
                if (start === 0) {
                    if (def.vertical) row++; else col++;
                    continue;
                }
                const s0 = start - 1, e0 = end - 1;
                let nn = s0;
                for (;;) {
                    if (nn >= 0 && nn < parentCount) {
                        nodeIndexes.push(nn);
                        const existing = nodeIndexMap.get(nn);
                        if (existing === undefined) {
                            startChannel = minChannel(startChannel, parentChannel(parent, nn));
                            nodeIndexMap.set(nn, nodes.length);
                            // the clone keeps only its first coord
                            nodes.push({ parentIndex: nn, coords: [{ bufX: col, bufY: row }] });
                        } else {
                            // a repeated node gets the new cell as its primary coord
                            nodes[existing].coords.unshift({ bufX: col, bufY: row });
                        }
                        if (def.vertical) row++; else col++;
                    } else {
                        nodesAllValid = false;
                    }
                    if (s0 > e0) { nn--; if (nn < e0) break; }
                    else { nn++; if (nn > e0) break; }
                }
            }
            if (def.vertical) row--; else col--;
            if (maxRow < row) maxRow = row;
            if (maxCol < col) maxCol = col;
            if (def.bufferStyle === STACKED_STRANDS) {
                row = 0; col = 0;
            } else if (def.vertical) {
                row = 0; col++;
            } else {
                col = 0; row++;
            }
            nodeIndexes.push(-1);
        }
        bufferWi = maxCol + 1;
        bufferHt = maxRow + 1;
    } else {
        // initSubbufferRange: nodes of the parent whose default-buffer coords fall in the box
        let x1 = 0, y1 = 0, x2 = 100, y2 = 100;
        if (def.subBuffer !== '') {
            const v = def.subBuffer.split('x');
            x1 = v.length > 0 ? toFloat(v[0]) : 0;
            y1 = v.length > 1 ? toFloat(v[1]) : 0;
            x2 = v.length > 2 ? toFloat(v[2]) : 100;
            y2 = v.length > 3 ? toFloat(v[3]) : 100;
        }
        if (x1 > x2) [x1, x2] = [x2, x1];
        if (y1 > y2) [y1, y2] = [y2, y1];
        const f = Math.fround;
        x1 = f(f(x1 * parent.logicalBufferWidth) / 100);
        x2 = f(f(x2 * parent.logicalBufferWidth) / 100);
        y1 = f(f(y1 * parent.logicalBufferHeight) / 100);
        y2 = f(f(y2 * parent.logicalBufferHeight) / 100);
        x1 = roundHalfAway(x1);
        y1 = roundHalfAway(y1);
        const inRange = (idx: number) => parent.nodes[idx].coords.some(c => c.bufX >= x1 && c.bufX <= x2 && c.bufY >= y1 && c.bufY <= y2);
        let minx = 10000, maxx = -1, miny = 10000, maxy = -1;
        for (let m = 0; m < parentCount; ++m) {
            if (!inRange(m)) continue;
            for (const c of parent.nodes[m].coords) {
                if (c.bufX < minx) minx = c.bufX;
                if (c.bufY < miny) miny = c.bufY;
                if (c.bufX > maxx) maxx = c.bufX;
                if (c.bufY > maxy) maxy = c.bufY;
            }
        }
        for (let m = 0; m < parentCount; ++m) {
            if (!inRange(m)) continue;
            startChannel = minChannel(startChannel, parentChannel(parent, m));
            nodeIndexMap.set(m, nodes.length);
            nodes.push({ parentIndex: m, coords: parent.nodes[m].coords.map(c => ({ bufX: c.bufX - minx, bufY: c.bufY - miny })) });
        }
        if (maxx < minx || maxy < miny || nodes.length === 0) {
            bufferWi = 1; bufferHt = 1;
        } else {
            bufferWi = Math.ceil(maxx - minx) + 1;
            bufferHt = Math.ceil(maxy - miny) + 1;
        }
    }

    // CheckDuplicates
    const sameLine = new Set<number>(), seen = new Set<number>(), cross = new Set<number>();
    let lineNodes = new Set<number>();
    for (const n of nodeIndexes) {
        if (n === -1) { lineNodes = new Set(); continue; }
        if (lineNodes.has(n)) sameLine.add(n); else lineNodes.add(n);
        if (seen.has(n) && !sameLine.has(n)) cross.add(n); else seen.add(n);
    }
    return {
        def, nodes, bufferWi, bufferHt, startChannel, nodesAllValid,
        sameLineDuplicates: [...sameLine].sort((a, b) => a - b).map(n => n + 1),
        crossLineDuplicates: [...cross].sort((a, b) => a - b).map(n => n + 1),
    };
}

function toFloat(s: string): number {
    const v = Number.parseFloat(s);
    return Number.isNaN(v) ? 0 : v;
}
function roundHalfAway(v: number): number {
    return v < 0 ? -Math.round(-v) : Math.round(v);
}

/** One-line-per-submodel summary, for layout reports. */
export function describeSubModel(sm: SubModelResult): string {
    const d = sm.def;
    const kind = d.isRanges ? (d.bufferStyle === KEEP_XY ? 'ranges/Keep XY' : d.bufferStyle === STACKED_STRANDS ? 'ranges/Stacked Strands' : `ranges/${d.vertical ? 'vertical' : 'horizontal'}`) : `subbuffer ${d.subBuffer || '0x0x100x100'}`;
    const warn: string[] = [];
    if (!sm.nodesAllValid) warn.push('nodes outside parent');
    if (sm.sameLineDuplicates.length) warn.push(`same-line duplicates ${sm.sameLineDuplicates.join(',')}`);
    if (sm.crossLineDuplicates.length) warn.push(`cross-line duplicates ${sm.crossLineDuplicates.join(',')}`);
    return `${d.name}: ${kind}, ${sm.nodes.length} nodes, buffer ${sm.bufferWi}x${sm.bufferHt}${warn.length ? ' [' + warn.join('; ') + ']' : ''}`;
}

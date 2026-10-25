/**
 * World-placement transforms for layout elements.
 *
 * Applies an affine transform (any composition of translate / rotate / scale)
 * to the placement attributes of every `<model>` and `<view_object>` in an
 * `xlights_rgbeffects.xml` document, rewriting WorldPos / Scale / Rotate,
 * X2/Y2/Z2 + RotateX/Height, or PointData so that xLights displays the whole
 * layout moved as one rigid body.  Both layout formats (x2026_2 and x2026_3+)
 * are handled — placement attributes are identical across them.
 *
 * Per screen-location kind (matching xLights' ModelScreenLocation classes):
 *
 *  - boxed   (Custom, Star, Tree, Matrix, Cube, Circle, Sphere, Spinner, Wreath,
 *             Window Frame, Image, DMX*, and Image/Mesh/Terrain view objects):
 *             world = T(pos) · Rz · Ry · Rx · S.  The new matrix M·world is
 *             decomposed back into position, scale, and Z·Y·X Euler angles with
 *             the same extraction xLights uses in BoxedScreenLocation::Rotate.
 *             Exact for rigid and uniform-scale transforms; a non-uniform scale
 *             applied to a rotated model cannot be represented (it shears) and
 *             is approximated with a warning.
 *  - 2-point (Single Line, Channel Block, Ruler): both endpoints are mapped.  Exact.
 *  - 3-point (Arches, Candy Canes, Icicles): both endpoints are mapped, and
 *             RotateX is recomputed so the model's "up" direction is carried
 *             along (xLights' own rotate tool leaves RotateX alone, which lets
 *             arches tip over).  Height is rescaled for non-uniform transforms.
 *             Angle and Shear are left unchanged.
 *  - poly    (Poly Line): every point (and Bezier control point) is mapped
 *             through world space and re-expressed relative to the new origin,
 *             keeping a uniform ScaleX/Y/Z as xLights' own rotate does (a
 *             non-uniform one is baked into the points).  Exact for the
 *             line itself; icicle drops always hang along world -Y in xLights,
 *             so they follow a rotation about Y but not about X or Z.  Their
 *             spacing (ModelHeight) is scaled with the transform.  Nodes are
 *             spread along the line by arc length, so a non-uniform scale of a
 *             curved or multi-segment poly line re-spaces them slightly.
 *
 * Known xLights quirk: a two/three-point line within about 0.8 degrees of the
 * X axis is drawn as exactly axis-aligned (rotationMatrixFromXAxisToVector
 * short-circuits at cos > 0.9999), so its small Y2/Z2 tilt is ignored until a
 * transform moves it out of that zone, when the tilt becomes visible.
 *
 * Matrices are plain 16-element column-major arrays (the same layout as a
 * gl-matrix `mat4`), computed in double precision.
 */

import { getBaseDisplayAs } from './xmlmigrate';

// ---------------------------------------------------------------------------
// Minimal double-precision affine helpers (column-major 4x4, m[col*4 + row])
// ---------------------------------------------------------------------------

export type Mat4 = number[];
export type Vec3 = [number, number, number];

export function mat4Identity(): Mat4 {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** a · b (apply b first, then a). */
export function mat4Multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
    const out = new Array<number>(16).fill(0);
    for (let c = 0; c < 4; ++c) {
        for (let r = 0; r < 4; ++r) {
            let s = 0;
            for (let k = 0; k < 4; ++k) s += a[k * 4 + r] * b[c * 4 + k];
            out[c * 4 + r] = s;
        }
    }
    return out;
}

export function mat4Translation(v: Vec3): Mat4 {
    const m = mat4Identity();
    m[12] = v[0];
    m[13] = v[1];
    m[14] = v[2];
    return m;
}

export function mat4Scaling(v: Vec3): Mat4 {
    const m = mat4Identity();
    m[0] = v[0];
    m[5] = v[1];
    m[10] = v[2];
    return m;
}

export function mat4RotationX(rad: number): Mat4 {
    const c = Math.cos(rad), s = Math.sin(rad);
    const m = mat4Identity();
    m[5] = c; m[6] = s;
    m[9] = -s; m[10] = c;
    return m;
}

export function mat4RotationY(rad: number): Mat4 {
    const c = Math.cos(rad), s = Math.sin(rad);
    const m = mat4Identity();
    m[0] = c; m[2] = -s;
    m[8] = s; m[10] = c;
    return m;
}

export function mat4RotationZ(rad: number): Mat4 {
    const c = Math.cos(rad), s = Math.sin(rad);
    const m = mat4Identity();
    m[0] = c; m[1] = s;
    m[4] = -s; m[5] = c;
    return m;
}

/** Rotation by `rad` about an arbitrary axis (normalized internally), as gl-matrix / glm do. */
export function mat4RotationAxis(rad: number, axis: Vec3): Mat4 {
    const len = Math.hypot(axis[0], axis[1], axis[2]);
    if (len < 1e-12) return mat4Identity();
    const x = axis[0] / len, y = axis[1] / len, z = axis[2] / len;
    const c = Math.cos(rad), s = Math.sin(rad), t = 1 - c;
    const m = mat4Identity();
    m[0] = x * x * t + c;     m[1] = y * x * t + z * s; m[2] = z * x * t - y * s;
    m[4] = x * y * t - z * s; m[5] = y * y * t + c;     m[6] = z * y * t + x * s;
    m[8] = x * z * t + y * s; m[9] = y * z * t - x * s; m[10] = z * z * t + c;
    return m;
}

export function mat4TransformPoint(m: ArrayLike<number>, p: Vec3): Vec3 {
    return [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
}

/** Transform a direction (ignores translation). */
export function mat4TransformVector(m: ArrayLike<number>, v: Vec3): Vec3 {
    return [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
    ];
}

function vlen(v: Vec3): number {
    return Math.hypot(v[0], v[1], v[2]);
}
function vsub(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function vadd(a: Vec3, b: Vec3): Vec3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function vdot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function vcross(a: Vec3, b: Vec3): Vec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function vscale(a: Vec3, s: number): Vec3 {
    return [a[0] * s, a[1] * s, a[2] * s];
}
function vnorm(a: Vec3): Vec3 {
    const l = vlen(a);
    return l > 0 ? vscale(a, 1 / l) : [0, 0, 0];
}
function col(m: ArrayLike<number>, c: number): Vec3 {
    return [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
}
function deg(rad: number): number {
    return (rad * 180) / Math.PI;
}
function rad(d: number): number {
    return (d * Math.PI) / 180;
}

// ---------------------------------------------------------------------------
// Transform composition
// ---------------------------------------------------------------------------

export type TransformStep =
    | { translate: Vec3 }
    | { scale: Vec3 }
    | { rotate: { axis: 'x' | 'y' | 'z'; degrees: number } };

/**
 * Compose transform steps applied in order (the first step acts on the layout
 * first). Rotations are about the world origin, right-handed, in degrees.
 */
export function composeTransform(steps: TransformStep[]): Mat4 {
    let m = mat4Identity();
    for (const step of steps) {
        let s: Mat4;
        if ('translate' in step) s = mat4Translation(step.translate);
        else if ('scale' in step) s = mat4Scaling(step.scale);
        else {
            const r = rad(step.rotate.degrees);
            s = step.rotate.axis === 'x' ? mat4RotationX(r) : step.rotate.axis === 'y' ? mat4RotationY(r) : mat4RotationZ(r);
        }
        m = mat4Multiply(s, m);
    }
    return m;
}

// ---------------------------------------------------------------------------
// Boxed placement: T · Rz · Ry · Rx · S
// ---------------------------------------------------------------------------

export interface BoxedPlacement {
    position: Vec3;
    scale: Vec3;
    /** Degrees about X, Y, Z (xLights RotateX/Y/Z). */
    rotationDegrees: Vec3;
}

/** The world matrix xLights builds for a boxed placement (BoxedScreenLocation). */
export function boxedWorldMatrix(p: BoxedPlacement): Mat4 {
    let m = mat4Translation(p.position);
    m = mat4Multiply(m, mat4RotationZ(rad(p.rotationDegrees[2])));
    m = mat4Multiply(m, mat4RotationY(rad(p.rotationDegrees[1])));
    m = mat4Multiply(m, mat4RotationX(rad(p.rotationDegrees[0])));
    m = mat4Multiply(m, mat4Scaling(p.scale));
    return m;
}

/**
 * Euler angles (radians, X/Y/Z) of a rotation matrix built as Rz·Ry·Rx —
 * the same extraction as xLights' rotationMatrixToEulerAngles.
 */
export function eulerFromRotation(m: ArrayLike<number>): Vec3 {
    const m13 = m[2]; // column 0, row 2
    const y = -Math.asin(Math.max(-1, Math.min(1, m13)));
    let x: number, z: number;
    if (Math.abs(m13) < 0.9999) {
        x = Math.atan2(m[6], m[10]);
        z = Math.atan2(m[1], m[0]);
    } else {
        x = Math.atan2(m[9], m[5]);
        z = 0;
    }
    return [x, y, z];
}

export interface BoxedDecomposition extends BoxedPlacement {
    /** Largest residual non-orthogonality (0 for an exactly representable matrix). */
    shearResidual: number;
}

/**
 * Decompose an affine matrix into xLights position / scale / Z·Y·X rotation.
 * `signHint` carries the original scale signs so mirrored models keep their
 * negative scale rather than flipping a rotation axis.
 */
export function decomposeBoxed(m: ArrayLike<number>, signHint: Vec3 = [1, 1, 1]): BoxedDecomposition {
    const position: Vec3 = [m[12], m[13], m[14]];
    const c: Vec3[] = [col(m, 0), col(m, 1), col(m, 2)];

    // Start from the column directions, honoring the caller's scale signs.
    let axes: Vec3[] = c.map((v, i) => vnorm(vscale(v, signHint[i] < 0 ? -1 : 1)));
    // A reflection can't be a rotation: flip X's sign if the frame is left-handed.
    const handed = vdot(vcross(axes[0], axes[1]), axes[2]);
    const signs: Vec3 = [signHint[0] < 0 ? -1 : 1, signHint[1] < 0 ? -1 : 1, signHint[2] < 0 ? -1 : 1];
    if (handed < 0) {
        axes[0] = vscale(axes[0], -1);
        signs[0] = -signs[0];
    }

    // Gram-Schmidt so the result is a proper rotation even if M sheared.
    const x = vnorm(axes[0]);
    let y = vsub(axes[1], vscale(x, vdot(axes[1], x)));
    y = vnorm(y);
    let z = vcross(x, y);
    if (vlen(z) < 1e-9) z = vnorm(axes[2]);
    axes = [x, y, z];

    const scale: Vec3 = [0, 0, 0];
    let shearResidual = 0;
    for (let i = 0; i < 3; ++i) {
        const len = vlen(c[i]);
        scale[i] = signs[i] * len;
        if (len > 0) {
            // Residual = how far the column is from its orthonormalized axis.
            const proj = Math.abs(vdot(vnorm(c[i]), axes[i]));
            shearResidual = Math.max(shearResidual, 1 - proj);
        }
    }

    const r: Mat4 = mat4Identity();
    for (let i = 0; i < 3; ++i) {
        r[i * 4] = axes[i][0];
        r[i * 4 + 1] = axes[i][1];
        r[i * 4 + 2] = axes[i][2];
    }
    const e = eulerFromRotation(r);
    return { position, scale, rotationDegrees: [deg(e[0]), deg(e[1]), deg(e[2])], shearResidual };
}

// ---------------------------------------------------------------------------
// 3-point base rotation (ThreePointScreenLocation with RotateX = 0)
// ---------------------------------------------------------------------------

/** Rotation taking the +X axis onto vector `a` (VectorMath::rotationMatrixFromXAxisToVector). */
function rotationFromXAxisToVector(a: Vec3): Mat4 {
    const len = vlen(a);
    if (len === 0) return mat4Identity();
    const ax = a[0] / len;
    const angle = Math.acos(Math.max(-1, Math.min(1, ax)));
    if (ax > 0.9999 || angle === 0) return mat4Identity();
    if (ax < -0.9999 || Math.abs(angle - Math.PI) < 0.0001) return mat4RotationY(Math.PI);
    return mat4RotationAxis(angle, [0, -a[2], a[1]]);
}

/**
 * The rotation part of a three-point placement before RotateX is applied:
 * R(x→d) for d.x >= 0, or R(x→-d)·Ry(180°) when the endpoints are swapped
 * (x2 < 0), exactly as ThreePointScreenLocation::PrepareToDraw does.
 */
function threePointBaseRotation(d: Vec3): Mat4 {
    if (d[0] < 0) {
        return mat4Multiply(rotationFromXAxisToVector(vscale(d, -1)), mat4RotationY(Math.PI));
    }
    return rotationFromXAxisToVector(d);
}

// ---------------------------------------------------------------------------
// Element-level transforms
// ---------------------------------------------------------------------------

export type PlacementKind = 'boxed' | 'two-point' | 'three-point' | 'poly';

export interface PlacementTransformOptions {
    /** Also move Gridlines view objects (default false: the grid usually marks the ground). */
    includeGridlines?: boolean;
    /** Skip elements with Locked="1" (default false: a whole-layout move includes them). */
    respectLocked?: boolean;
    /** Sink for warnings; default console.warn. */
    logger?: (msg: string) => void;
}

export interface PlacementTransformResult {
    modelsTransformed: number;
    viewObjectsTransformed: number;
    /** Elements that were not transformed, with the reason. */
    skipped: { name: string; reason: string }[];
    /** Elements transformed approximately (non-representable shear). */
    warnings: string[];
}

const TWO_POINT_MODELS = new Set(['Single Line', 'Channel Block']);
const THREE_POINT_MODELS = new Set(['Arches', 'Candy Canes', 'Icicles']);
const POLY_MODELS = new Set(['Poly Line']);
const BOXED_MODELS = new Set([
    'Custom', 'Star', 'Tree', 'Matrix', 'Cube', 'Circle', 'Sphere', 'Spinner', 'Wreath',
    'Window Frame', 'Image', 'Dmx',
]);

function numAttr(el: Element, name: string, def: number): number {
    const v = el.getAttribute(name);
    if (v === null || v === '') return def;
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : def;
}

function fmt(n: number, decimals: number): string {
    let s = n.toFixed(decimals);
    if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
    return s;
}

function normDeg(d: number): number {
    let x = d % 360;
    if (x > 180) x -= 360;
    if (x <= -180) x += 360;
    return x;
}

const TWO_POINT_VIEW_OBJECTS = new Set(['Ruler']);

/**
 * Decide which placement kind an element uses.  View objects are classified
 * by DisplayAs only (a Terrain carries a PointData height map that is not a
 * poly line); unknown model types fall back to the attributes present.
 */
export function placementKindOf(el: Element): PlacementKind | undefined {
    const da = el.getAttribute('DisplayAs') ?? '';
    if (el.tagName === 'view_object') {
        if (TWO_POINT_VIEW_OBJECTS.has(da)) return 'two-point';
        return el.hasAttribute('WorldPosX') ? 'boxed' : undefined;
    }
    const base = getBaseDisplayAs(da);
    if (POLY_MODELS.has(base)) return 'poly';
    if (THREE_POINT_MODELS.has(base)) return 'three-point';
    if (TWO_POINT_MODELS.has(base)) return 'two-point';
    if (BOXED_MODELS.has(base)) return 'boxed';
    // Unknown model types: infer from the attributes present.
    if (el.hasAttribute('PointData')) return 'poly';
    if (el.hasAttribute('X2')) {
        return el.hasAttribute('Height') || el.hasAttribute('RotateX') ? 'three-point' : 'two-point';
    }
    if (el.hasAttribute('WorldPosX')) return 'boxed';
    return undefined;
}

function getPos(el: Element): Vec3 {
    return [numAttr(el, 'WorldPosX', 0), numAttr(el, 'WorldPosY', 0), numAttr(el, 'WorldPosZ', 0)];
}

function setPos(el: Element, p: Vec3): void {
    el.setAttribute('WorldPosX', fmt(p[0], 4));
    el.setAttribute('WorldPosY', fmt(p[1], 4));
    el.setAttribute('WorldPosZ', fmt(p[2], 4));
}

function setSecondPoint(el: Element, d: Vec3): void {
    el.setAttribute('X2', fmt(d[0], 6));
    el.setAttribute('Y2', fmt(d[1], 6));
    el.setAttribute('Z2', fmt(d[2], 6));
}

function transformBoxed(el: Element, m: ArrayLike<number>, name: string, warnings: string[]): void {
    const placement: BoxedPlacement = {
        position: getPos(el),
        scale: [numAttr(el, 'ScaleX', 1), numAttr(el, 'ScaleY', 1), numAttr(el, 'ScaleZ', 1)],
        rotationDegrees: [numAttr(el, 'RotateX', 0), numAttr(el, 'RotateY', 0), numAttr(el, 'RotateZ', 0)],
    };
    const world = mat4Multiply(m, boxedWorldMatrix(placement));
    const d = decomposeBoxed(world, placement.scale);
    if (d.shearResidual > 1e-6) {
        warnings.push(`${name}: non-uniform scale on a rotated model cannot be represented exactly (residual ${d.shearResidual.toExponential(2)})`);
    }
    setPos(el, d.position);
    el.setAttribute('ScaleX', fmt(d.scale[0], 4));
    el.setAttribute('ScaleY', fmt(d.scale[1], 4));
    el.setAttribute('ScaleZ', fmt(d.scale[2], 4));
    el.setAttribute('RotateX', fmt(normDeg(d.rotationDegrees[0]), 8));
    el.setAttribute('RotateY', fmt(normDeg(d.rotationDegrees[1]), 8));
    el.setAttribute('RotateZ', fmt(normDeg(d.rotationDegrees[2]), 8));
}

function transformTwoPoint(el: Element, m: ArrayLike<number>): void {
    const pos = getPos(el);
    const d: Vec3 = [numAttr(el, 'X2', 0), numAttr(el, 'Y2', 0), numAttr(el, 'Z2', 0)];
    const pos2 = mat4TransformPoint(m, pos);
    const end2 = mat4TransformPoint(m, vadd(pos, d));
    setPos(el, pos2);
    setSecondPoint(el, vsub(end2, pos2));
}

function transformThreePoint(el: Element, m: ArrayLike<number>): void {
    const pos = getPos(el);
    const d: Vec3 = [numAttr(el, 'X2', 0), numAttr(el, 'Y2', 0), numAttr(el, 'Z2', 0)];
    const rotX = numAttr(el, 'RotateX', 0);
    const height = numAttr(el, 'Height', 1);

    const pos2 = mat4TransformPoint(m, pos);
    const end2 = mat4TransformPoint(m, vadd(pos, d));
    const d2 = vsub(end2, pos2);
    setPos(el, pos2);
    setSecondPoint(el, d2);

    const len = vlen(d);
    const len2 = vlen(d2);
    if (len === 0 || len2 === 0) return;

    // World "up" of the model: base rotation, then RotateX about the local X axis.
    const base = threePointBaseRotation(d);
    const t = rad(rotX);
    const upWorld = mat4TransformVector(base, [0, Math.cos(t), Math.sin(t)]);
    // Where that direction goes under the transform (direction only).
    const upNew = mat4TransformVector(m, upWorld);
    const upLen = vlen(upNew);
    if (upLen === 0) return;

    // Express it in the new base frame and read off the new RotateX.
    const base2 = threePointBaseRotation(d2);
    const v: Vec3 = [
        vdot(col(base2, 0), upNew),
        vdot(col(base2, 1), upNew),
        vdot(col(base2, 2), upNew),
    ];
    const rotX2 = deg(Math.atan2(v[2], v[1]));
    el.setAttribute('RotateX', fmt(normDeg(rotX2), 8));

    // Height is relative to the line length: keep the world-space height extent.
    if (el.hasAttribute('Height')) {
        const height2 = height * (upLen * len) / len2;
        el.setAttribute('Height', fmt(height2, 6));
    }
}

function transformPoly(el: Element, m: ArrayLike<number>, name: string, warnings: string[]): void {
    const pos = getPos(el);
    const s: Vec3 = [numAttr(el, 'ScaleX', 1), numAttr(el, 'ScaleY', 1), numAttr(el, 'ScaleZ', 1)];
    for (let i = 0; i < 3; ++i) if (!(s[i] > 0) || !Number.isFinite(s[i])) s[i] = 1;
    const pos2 = mat4TransformPoint(m, pos);

    // xLights spaces the nodes evenly in the scaled point space, so a
    // non-uniform ScaleX/Y/Z would re-space them under a rotation.  Bake such
    // a scale into the points (scale 1) when the transform rotates; for a pure
    // translation / scale the spacing is preserved with the scale kept.
    let s2: Vec3 = s;
    const rotates = [1, 2, 4, 6, 8, 9].some((i) => Math.abs(m[i]) > 1e-12);
    if (rotates && (s[0] !== s[1] || s[1] !== s[2])) {
        s2 = [1, 1, 1];
        warnings.push(`${name}: non-uniform ScaleX/Y/Z baked into PointData (scale set to 1)`);
    }

    const mapPoint = (p: Vec3): Vec3 => {
        const w = mat4TransformPoint(m, [pos[0] + s[0] * p[0], pos[1] + s[1] * p[1], pos[2] + s[2] * p[2]]);
        return [(w[0] - pos2[0]) / s2[0], (w[1] - pos2[1]) / s2[1], (w[2] - pos2[2]) / s2[2]];
    };

    const pointData = (el.getAttribute('PointData') ?? '').split(',').map((v) => Number.parseFloat(v.trim()));
    const outPts: string[] = [];
    for (let i = 0; i + 2 < pointData.length; i += 3) {
        const q = mapPoint([pointData[i] || 0, pointData[i + 1] || 0, pointData[i + 2] || 0]);
        outPts.push(fmt(q[0], 6), fmt(q[1], 6), fmt(q[2], 6));
    }
    if (outPts.length) el.setAttribute('PointData', outPts.join(','));

    // Curve control points: seg, cp0(x,y,z), cp1(x,y,z), ... in the same point space.
    const cData = (el.getAttribute('cPointData') ?? '').trim();
    if (cData) {
        const cv = cData.split(',').map((v) => Number.parseFloat(v.trim()));
        const out: string[] = [];
        for (let i = 0; i + 6 < cv.length; i += 7) {
            const cp0 = mapPoint([cv[i + 1] || 0, cv[i + 2] || 0, cv[i + 3] || 0]);
            const cp1 = mapPoint([cv[i + 4] || 0, cv[i + 5] || 0, cv[i + 6] || 0]);
            out.push(`${Math.floor(cv[i])}`, fmt(cp0[0], 6), fmt(cp0[1], 6), fmt(cp0[2], 6), fmt(cp1[0], 6), fmt(cp1[1], 6), fmt(cp1[2], 6));
        }
        el.setAttribute('cPointData', out.join(','));
    }

    setPos(el, pos2);
    el.setAttribute('ScaleX', fmt(s2[0], 4));
    el.setAttribute('ScaleY', fmt(s2[1], 4));
    el.setAttribute('ScaleZ', fmt(s2[2], 4));

    // Icicle drops hang along world -Y with a spacing of ScaleY * ModelHeight * 10
    // world units, so a scale changes the spacing; the direction itself cannot rotate.
    if (el.hasAttribute('ModelHeight') || el.hasAttribute('DropPattern')) {
        const yStretch = vlen(mat4TransformVector(m, [0, 1, 0]));
        const factor = (yStretch * s[1]) / s2[1];
        if (yStretch > 0 && Math.abs(factor - 1) > 1e-12) {
            el.setAttribute('ModelHeight', fmt(numAttr(el, 'ModelHeight', 1) * factor, 6));
        }
    }
}

/**
 * Transform one `<model>` or `<view_object>` element in place.
 * Returns the placement kind used, or undefined (with the reason in `result`) if skipped.
 */
export function transformPlacementElement(
    el: Element,
    m: ArrayLike<number>,
    options: PlacementTransformOptions = {},
    result?: PlacementTransformResult,
): PlacementKind | undefined {
    const name = el.getAttribute('name') ?? '<unnamed>';
    const skip = (reason: string): undefined => {
        result?.skipped.push({ name, reason });
        return undefined;
    };
    if (options.respectLocked && (el.getAttribute('Locked') ?? '0') === '1') return skip('locked');
    const da = el.getAttribute('DisplayAs') ?? '';
    if (da === 'Gridlines' && !options.includeGridlines) return skip('Gridlines (pass includeGridlines to move)');
    const kind = placementKindOf(el);
    if (!kind) return skip(`no world placement attributes (DisplayAs "${da}")`);
    const warnings = result?.warnings ?? [];
    switch (kind) {
        case 'boxed': transformBoxed(el, m, name, warnings); break;
        case 'two-point': transformTwoPoint(el, m); break;
        case 'three-point': transformThreePoint(el, m); break;
        case 'poly': transformPoly(el, m, name, warnings); break;
    }
    return kind;
}

function childElements(parent: Element, tag: string): Element[] {
    const out: Element[] = [];
    for (let i = 0; i < parent.childNodes.length; ++i) {
        const k = parent.childNodes[i];
        if (k.nodeType === 1 && (k as Element).tagName === tag) out.push(k as Element);
    }
    return out;
}

/**
 * Transform the placement of every model and view object in an rgbeffects
 * document (either layout format) by the affine matrix `m`.  Mutates `doc`.
 */
export function transformLayoutPlacement(
    doc: Document,
    m: ArrayLike<number>,
    options: PlacementTransformOptions = {},
): PlacementTransformResult {
    const result: PlacementTransformResult = { modelsTransformed: 0, viewObjectsTransformed: 0, skipped: [], warnings: [] };
    const root = doc.documentElement;
    if (!root) return result;
    for (const models of childElements(root, 'models')) {
        for (const model of childElements(models, 'model')) {
            if (transformPlacementElement(model, m, options, result)) result.modelsTransformed++;
        }
    }
    for (const objs of childElements(root, 'view_objects')) {
        for (const vo of childElements(objs, 'view_object')) {
            if (transformPlacementElement(vo, m, options, result)) result.viewObjectsTransformed++;
        }
    }
    const log = options.logger ?? ((msg: string) => console.warn(msg));
    for (const w of result.warnings) log(`Warning: ${w}`);
    return result;
}

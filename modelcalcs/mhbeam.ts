// Moving Head Beam Descriptor
// Combines fixture world transform with pan/tilt angles to produce a
// world-space beam origin, direction, and rendering parameters.
// Pure math functions — no DmxModel import needed.

import { vec3, vec4, mat4 } from "gl-matrix";
import { MhPhysicalState } from "./mhcalc";

// ============================================================================
// Input Types
// ============================================================================

/** Beam geometry parameters from the xLights model. */
export interface MhBeamParams {
    /** Beam cone half-angle in degrees. */
    dmxBeamWidth: number;
    /** Beam length in model-space units. */
    dmxBeamLength: number;
    /** Y offset of beam emission point from fixture origin. */
    dmxBeamYOffset: number;
    /** Maximum effective beam length (0 = no limit). */
    dmxBeamLimit: number;
    /**
     * Controlling mesh dimensions (Width/Height/Depth from the HeadMesh/YokeMesh/BaseMesh
     * XML element that has set_size=true in xLights). These replicate xLights'
     * GetRenderWi/Ht/Dp and are used to scale beam length the same way xLights does:
     *   sbl = max(meshWidth * |scaleX|, meshHeight * |scaleY|, meshDepth * |scaleZ|)
     *   scaledLength = dmxBeamLength * sbl
     * Default 1.0 each (used for DmxMovingHead which always sets RenderSize to 1,1,1).
     */
    meshWidth: number;
    meshHeight: number;
    meshDepth: number;
}

/** World transform values from the xLights model (BoxedScreenLocation). */
export interface MhWorldTransform {
    worldPosX: number;
    worldPosY: number;
    worldPosZ: number;
    rotateX: number;
    rotateY: number;
    rotateZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
}

// ============================================================================
// Output Type
// ============================================================================

/** World-space beam descriptor for 3D visualization. */
export interface MhBeamDescriptor {
    /** World-space beam emission point. */
    origin: [number, number, number];
    /** Unit vector, world-space beam direction. */
    direction: [number, number, number];
    /** Beam cone half-angle in degrees. */
    coneHalfAngle: number;
    /** World-scaled beam length. */
    length: number;
    /** Red 0-255, modulated by dimmer. */
    r: number;
    /** Green 0-255, modulated by dimmer. */
    g: number;
    /** Blue 0-255, modulated by dimmer. */
    b: number;
    /** Raw dimmer 0-1. */
    dimmer: number;
    /** True if shutter is open. */
    shutterOpen: boolean;
}

// ============================================================================
// Beam Computation
// ============================================================================

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Convert a beam direction unit vector to pan-axis-relative swing angles.
 * Measures angular deviation from the +Y axis (pan axis) decomposed into
 * two planes. Continuous for any physical head path (discontinuity only at
 * -Y, which the head cannot reach).
 *
 * pa_rx: rotation around X axis — deviation from +Y toward +Z. 0° = +Y.
 * pa_rz: rotation around Z axis — deviation from +Y toward +X. 0° = +Y.
 */
export function directionToPanAxisAngles(dir: [number, number, number]): { paRx: number, paRz: number } {
    const [dx, dy, dz] = dir;
    const paRx = Math.atan2(dz, dy) * RAD_TO_DEG;
    const paRz = Math.atan2(dx, dy) * RAD_TO_DEG;
    return { paRx, paRz };
}

/**
 * Convert pan-axis-relative swing angles back to a beam direction unit vector.
 * Inverse of directionToPanAxisAngles().
 *
 * pa_rx: rotation around X axis — deviation from +Y toward +Z. 0° = +Y.
 * pa_rz: rotation around Z axis — deviation from +Y toward +X. 0° = +Y.
 */
export function panAxisAnglesToDirection(paRxDeg: number, paRzDeg: number): [number, number, number] {
    const rxRad = paRxDeg * DEG_TO_RAD;
    const rzRad = paRzDeg * DEG_TO_RAD;
    // Inverse of: paRx = atan2(dz, dy), paRz = atan2(dx, dy)
    // tan gives the ratio dz/dy and dx/dy, but loses the sign of dy.
    // Recover sign from cos(paRx): since paRx = atan2(dz, dy), the second
    // arg of atan2 is dy, and cos(atan2(y,x)) = x/hypot(x,y) = dy/hypot,
    // so sign(cos(paRx)) = sign(dy).
    const tanRx = Math.tan(rxRad);
    const tanRz = Math.tan(rzRad);
    const signDy = Math.cos(rxRad) >= 0 ? 1 : -1;
    const dyMag = 1 / Math.sqrt(1 + tanRx * tanRx + tanRz * tanRz);
    const dy = signDy * dyMag;
    const dz = dy * tanRx;
    const dx = dy * tanRz;
    return [dx, dy, dz];
}

/**
 * Compute a world-space beam descriptor from MH physical state, beam params,
 * and world transform.
 *
 * Returns null if the beam is unconfigured (dmxBeamWidth <= 0 AND dmxBeamLength <= 0).
 */
export function computeBeamDescriptor(
    state: MhPhysicalState,
    beamParams: MhBeamParams,
    worldTransform: MhWorldTransform,
): MhBeamDescriptor | null {
    // Edge case: unconfigured beam
    if (beamParams.dmxBeamWidth <= 0 && beamParams.dmxBeamLength <= 0) {
        return null;
    }

    // Defaults for partially-configured beams
    const coneHalfAngle = beamParams.dmxBeamWidth > 0 ? beamParams.dmxBeamWidth : 5;
    let dmxBeamLength = beamParams.dmxBeamLength > 0 ? beamParams.dmxBeamLength : 1.0;

    // Step 1: Beam default direction along +X
    const beamDir = vec4.fromValues(1, 0, 0, 0); // w=0 for direction

    // Step 2: Build tilt (rotateZ) and pan (rotateY) matrices
    // Tilt is negated: motor convention has negative angles for upward tilt,
    // but positive rotateZ maps +X toward +Y (up).
    const tiltMat = mat4.create();
    mat4.rotateZ(tiltMat, mat4.create(), -state.tiltAngle * DEG_TO_RAD);

    const panMat = mat4.create();
    mat4.rotateY(panMat, mat4.create(), state.panAngle * DEG_TO_RAD);

    // Step 3: Apply: panMat * tiltMat * beamDir → fixture-local beam direction
    const localDir = vec4.create();
    const panTilt = mat4.create();
    mat4.multiply(panTilt, panMat, tiltMat);
    vec4.transformMat4(localDir, beamDir, panTilt);

    // Step 4: Beam origin at [0, dmxBeamYOffset, 0] in fixture-local space
    const localOrigin = vec4.fromValues(0, beamParams.dmxBeamYOffset, 0, 1); // w=1 for point

    // Step 5: Build world matrix (same math as getWorldMatrixForBoxed)
    const worldMat = buildWorldMatrix(worldTransform);

    // Step 6: Transform origin and direction through world matrix
    const worldOrigin = vec4.create();
    vec4.transformMat4(worldOrigin, localOrigin, worldMat);

    const worldDir = vec4.create();
    vec4.transformMat4(worldDir, localDir, worldMat);

    // Step 7: Normalize direction; derive scale factor from pre-normalized length
    const dirVec3 = vec3.fromValues(worldDir[0], worldDir[1], worldDir[2]);
    const dirLength = vec3.length(dirVec3);
    if (dirLength > 0) {
        vec3.scale(dirVec3, dirVec3, 1 / dirLength);
    }

    // Scale beam length using xLights' formula:
    //   sbl = max(meshWidth * |scaleX|, meshHeight * |scaleY|, meshDepth * |scaleZ|)
    //   scaledLength = dmxBeamLength * sbl
    // This matches DmxMovingHeadAdv.cpp lines 935-939.
    const sbl = Math.max(
        beamParams.meshWidth * Math.abs(worldTransform.scaleX),
        beamParams.meshHeight * Math.abs(worldTransform.scaleY),
        beamParams.meshDepth * Math.abs(worldTransform.scaleZ),
    );
    let scaledLength = dmxBeamLength * (sbl > 0 ? sbl : dirLength);

    // Step 8: Apply dmxBeamLimit cap
    if (beamParams.dmxBeamLimit > 0 && scaledLength > beamParams.dmxBeamLimit) {
        scaledLength = beamParams.dmxBeamLimit;
    }

    // Modulate color by dimmer
    const dimmer = state.dimmer;
    const r = Math.round(state.r * dimmer);
    const g = Math.round(state.g * dimmer);
    const b = Math.round(state.b * dimmer);

    return {
        origin: [worldOrigin[0], worldOrigin[1], worldOrigin[2]],
        direction: [dirVec3[0], dirVec3[1], dirVec3[2]],
        coneHalfAngle,
        length: scaledLength,
        r,
        g,
        b,
        dimmer,
        shutterOpen: state.shutterOpen,
    };
}

// ============================================================================
// World Matrix (matches getWorldMatrixForBoxed, no perspective)
// ============================================================================

function buildWorldMatrix(wt: MhWorldTransform): mat4 {
    const scalingMatrix = mat4.create();
    mat4.scale(scalingMatrix, mat4.create(), [wt.scaleX, wt.scaleY, wt.scaleZ]);

    const rotXMatrix = mat4.create();
    mat4.rotateX(rotXMatrix, mat4.create(), wt.rotateX * DEG_TO_RAD);

    const rotYMatrix = mat4.create();
    mat4.rotateY(rotYMatrix, mat4.create(), wt.rotateY * DEG_TO_RAD);

    const rotZMatrix = mat4.create();
    mat4.rotateZ(rotZMatrix, mat4.create(), wt.rotateZ * DEG_TO_RAD);

    const translateMatrix = mat4.create();
    mat4.translate(translateMatrix, mat4.create(), [wt.worldPosX, wt.worldPosY, wt.worldPosZ]);

    // Combine: T * Rz * Ry * Rx * S (matching getWorldMatrixForBoxed)
    const matrix = mat4.create();
    mat4.multiply(matrix, translateMatrix, rotZMatrix);
    mat4.multiply(matrix, matrix, rotYMatrix);
    mat4.multiply(matrix, matrix, rotXMatrix);
    mat4.multiply(matrix, matrix, scalingMatrix);

    return matrix;
}

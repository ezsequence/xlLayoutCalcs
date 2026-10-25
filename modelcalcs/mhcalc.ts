// Moving Head Calculation Engine
// Forward: channel data → physical state
// Reverse: physical state → channel data
// Pure math functions with no dependencies beyond basic JS.
//
// Matches xLights src-core/models/DMX rendering semantics (Adv convention;
// legacy DmxMovingHead differences are folded into the parsed MhDefinition —
// see mhdef.parseMhDefinition and doc/MovingHeadModel.md).

import {
    MhDefinition,
    MhMotorDef,
    MhColorDef,
    MhDimmerDef,
    MhShutterDef,
    MhColorWheelEntry,
    motorIs16Bit,
    motorMaxValue,
} from "./mhdef";

// ============================================================================
// Physical State
//
// Angle convention (matches xLights DmxMotor + DmxMovingHeadAdv):
//   - At DMX channel value 0, the raw motor position is 0 degrees.
//   - Increasing channel values move the motor in the negative direction:
//     at max channel value, raw position = -rangeOfMotion.
//   - orient_zero is then added to get the final display angle.
//   - With reverse=true, the sign is flipped (increasing values → positive).
//
// Pan:  0° = forward-facing (before orient_zero adjustment).
//       Positive = counter-clockwise when viewed from above.
// Tilt: 0° = level/horizontal (before orient_zero adjustment).
//       Negative = tilting upward, positive = tilting downward.
//       (Motor formula produces increasingly negative values as DMX increases;
//        beam computation negates tilt so that +rotateZ maps to +Y/up.)
//
// orient_zero shifts the fixture's zero reference in the physical world,
// e.g. orient_zero=90 on pan means "forward" is 90° from the DMX-zero position.
// These offsets are fixture-specific and configured per-motor in the xLights model.
// ============================================================================

export interface MhPhysicalState {
    /**
     * Pan angle in degrees (orient_zero already applied).
     * 0° = forward, positive = counter-clockwise from above.
     */
    panAngle: number;
    /**
     * Tilt angle in degrees (orient_zero already applied).
     * 0° = level, negative = upward, positive = downward.
     */
    tiltAngle: number;
    /** Effective beam red 0-255 (xLights GetBeamColor semantics: white-wins,
     *  CMY inversion/grey rule, wheel matching + wheel dimmer applied). */
    r: number;
    /** Effective beam green 0-255. */
    g: number;
    /** Effective beam blue 0-255. */
    b: number;
    /** Raw white channel value 0-255 (informational; already folded into r/g/b). */
    w: number;
    /** Model-level dimmer value 0.0-1.0 (MhDimmerChannel). */
    dimmer: number;
    /** True if shutter is open. */
    shutterOpen: boolean;
}

// ============================================================================
// Motor Forward: channel value → angle
// ============================================================================

/**
 * Read a channel value from channelData using 1-based channel number.
 * channelData is indexed 0-based (channel 1 → index 0).
 */
function readChannel(channelData: Uint8Array, channel1Based: number): number {
    if (channel1Based <= 0 || channel1Based > channelData.length) return 0;
    return channelData[channel1Based - 1];
}

/** True when a 1-based channel is assigned and within the model (xLights CheckChannel). */
function checkChannel(channelData: Uint8Array, channel1Based: number): boolean {
    return channel1Based > 0 && channel1Based <= channelData.length;
}

/**
 * Read the raw 16-bit motor value from channel data, matching xLights
 * DmxModel::GetChannelValue(coarse, fine): the coarse byte is the MSB and an
 * unassigned fine channel contributes 0, so an 8-bit motor's value is
 * (coarse << 8), max 65280.
 *
 * NOTE: we deliberately do NOT emulate xLights' off-by-one bounds quirk that
 * reads 0 when the coarse channel is the model's last channel — we decode the
 * commanded value (the fixture linter flags that configuration instead).
 */
function readMotorValue(channelData: Uint8Array, motor: MhMotorDef): number {
    const coarse = readChannel(channelData, motor.channelCoarse);
    const fine = motorIs16Bit(motor) ? readChannel(channelData, motor.channelFine) : 0;
    return (coarse << 8) | fine;
}

/**
 * xLights DmxMotor::GetPosition formula (min_value=0, max_value=65535):
 *   position = -rev * ROM * channelValue / 65535
 * plus orient_zero (applied by the Adv model after GetPosition).
 *
 * At channelValue=0 → orientZero.  At 65535 → orientZero - ROM (or + if reversed).
 */
export function motorGetPosition(motor: MhMotorDef, channelValue: number): number {
    const maxVal = motorMaxValue(motor);
    const rev = motor.reverse ? -1 : 1;
    const position = ((1.0 - channelValue / maxVal) * (rev * motor.rangeOfMotion)) - (rev * motor.rangeOfMotion);
    return position + motor.orientZero;
}

/**
 * Read motor angle from channel data (convenience).
 */
function readMotorAngle(channelData: Uint8Array, motor: MhMotorDef): number {
    const channelValue = readMotorValue(channelData, motor);
    return motorGetPosition(motor, channelValue);
}

// ============================================================================
// Motor Reverse: physical angle → channel value (true inverse of GetPosition)
// ============================================================================

/**
 * Snap a raw 16-bit command value to what the wire can actually carry:
 * 16-bit motors carry all 16 bits; 8-bit motors carry only the MSB (the
 * fixture sees byte<<8), so quantize to the nearest byte<<8.
 */
export function motorQuantizeCmd(motor: MhMotorDef, cmd: number): number {
    const maxVal = motorMaxValue(motor);
    const clamped = Math.max(0, Math.min(maxVal, Math.round(cmd)));
    if (motorIs16Bit(motor)) return clamped;
    const byte = Math.min(255, Math.round(clamped / 256));
    return byte << 8;
}

/**
 * Physical angle window permitted by the motor's limits.
 *
 * xLights' ConvertPosToCmd clamps an effect "position" to [minLimit, maxLimit]
 * and measures it from orientHome:  cmd = (home + rev·u·pos) · max / ROM
 * (u = −1 when upside down).  Feeding that through GetPosition
 * (physAngle = orientZero − rev·ROM·cmd/max) gives
 *   physAngle = orientZero − rev·orientHome − u·pos
 * so the limits bound physical angles around orientZero − rev·orientHome,
 * not around orientZero.
 */
export function motorLimitWindow(motor: MhMotorDef): [number, number] {
    const rev = motor.reverse ? -1 : 1;
    const center = motor.orientZero - rev * motor.orientHome;
    if (motor.upsideDown) {
        return [center + motor.minLimit, center + motor.maxLimit];
    }
    return [center - motor.maxLimit, center - motor.minLimit];
}

/**
 * Inverse of motorGetPosition: convert a physical angle to the channel value
 * that produces it.  Guaranteed round-trip:
 *   motorGetPosition(motor, motorPhysAngleToCmd(motor, angle)) ≈ angle
 * (within DMX quantization error — one MSB step for 8-bit motors).
 *
 * Note: xLights' ConvertPosToCmd uses orient_home (a separate parameter) and
 * is NOT the mathematical inverse of GetPosition.  This function uses only
 * orient_zero, matching the DmxMovingHeadAdv rendering path exactly.
 */
export function motorPhysAngleToCmd(motor: MhMotorDef, physAngle: number): number {
    const maxVal = motorMaxValue(motor);
    const rev = motor.reverse ? -1 : 1;

    // Clamp to commandable physical range (respects motor limits).
    const [physLo, physHi] = motorLimitWindow(motor);
    const clamped = Math.max(physLo, Math.min(physHi, physAngle));

    // Direct inverse of:  physAngle = orientZero − rev·ROM·cv / maxVal
    let cv = (motor.orientZero - clamped) * maxVal / (rev * motor.rangeOfMotion);

    // Wrap into [0, maxVal]  (same wrap logic as ConvertPosToCmd)
    const fullSpin = maxVal * 360.0 / motor.rangeOfMotion;
    if (cv < 0) {
        if (cv + fullSpin <= maxVal) {
            cv += fullSpin;
        } else {
            cv = 0;
        }
    } else if (cv > maxVal) {
        if (cv - fullSpin >= 0) {
            cv -= fullSpin;
        } else {
            cv = maxVal;
        }
    }

    return motorQuantizeCmd(motor, cv);
}

// ============================================================================
// Color Forward: channel data → effective beam RGB (xLights GetBeamColor)
// ============================================================================

export interface RGBColor {
    r: number;
    g: number;
    b: number;
    w: number;
}

/**
 * RGBW per DmxColorAbilityRGB::GetBeamColor:
 *  - all of R/G/B assigned: white channel wins if non-zero, else read RGB
 *    (components whose channel is out of range keep the xlWHITE init of 255);
 *  - else if W assigned: grey (w,w,w);
 *  - else: white.
 */
function readColorRGBW(channelData: Uint8Array, c: MhColorDef): RGBColor {
    let r = 255, g = 255, b = 255;
    const wVal = checkChannel(channelData, c.whiteChannel) ? readChannel(channelData, c.whiteChannel) : 0;

    if (c.redChannel > 0 && c.greenChannel > 0 && c.blueChannel > 0) {
        if (wVal !== 0) {
            return { r: wVal, g: wVal, b: wVal, w: wVal };
        }
        if (checkChannel(channelData, c.redChannel)) r = readChannel(channelData, c.redChannel);
        if (checkChannel(channelData, c.greenChannel)) g = readChannel(channelData, c.greenChannel);
        if (checkChannel(channelData, c.blueChannel)) b = readChannel(channelData, c.blueChannel);
        return { r, g, b, w: 0 };
    }
    if (checkChannel(channelData, c.whiteChannel)) {
        return { r: wVal, g: wVal, b: wVal, w: wVal };
    }
    return { r: 255, g: 255, b: 255, w: 0 };
}

/**
 * CMYW per DmxColorAbilityCMY::GetBeamColor/GetRGB:
 *  - white channel wins if non-zero;
 *  - C == M == Y → grey (c,c,c) — xLights' "really a dimmer" rule (NOT subtractive);
 *  - else per-component inversion rgb = 255 - cmy.
 */
function readColorCMY(channelData: Uint8Array, cdef: MhColorDef): RGBColor {
    const wVal = checkChannel(channelData, cdef.whiteChannel) ? readChannel(channelData, cdef.whiteChannel) : 0;

    if (cdef.redChannel > 0 && cdef.greenChannel > 0 && cdef.blueChannel > 0) {
        if (wVal !== 0) {
            return { r: wVal, g: wVal, b: wVal, w: wVal };
        }
        const c = checkChannel(channelData, cdef.redChannel) ? readChannel(channelData, cdef.redChannel) : 0;
        const m = checkChannel(channelData, cdef.greenChannel) ? readChannel(channelData, cdef.greenChannel) : 0;
        const y = checkChannel(channelData, cdef.blueChannel) ? readChannel(channelData, cdef.blueChannel) : 0;
        if (c === m && c === y) {
            return { r: c, g: c, b: c, w: 0 };
        }
        return { r: 255 - c, g: 255 - m, b: 255 - y, w: 0 };
    }
    if (checkChannel(channelData, cdef.whiteChannel)) {
        return { r: wVal, g: wVal, b: wVal, w: wVal };
    }
    return { r: 255, g: 255, b: 255, w: 0 };
}

/**
 * Color wheel per DmxColorAbilityWheel::GetBeamColor:
 *  - wheel channel unassigned or no colors: always white;
 *  - else match the wheel value to a color (three strategies, see
 *    lookupColorWheel), then apply the wheel's own dimmer channel (val/255).
 */
function readColorWheel(channelData: Uint8Array, c: MhColorDef): RGBColor {
    let col: RGBColor = { r: 255, g: 255, b: 255, w: 0 };
    if (checkChannel(channelData, c.colorWheelChannel) && c.colorWheelEntries.length > 0) {
        const wheelVal = readChannel(channelData, c.colorWheelChannel);
        col = lookupColorWheel(c.colorWheelEntries, wheelVal);
    }

    // Deliberate deviation from xLights' GetBeamColor, which only applies the
    // wheel's dimmer channel inside the "wheel channel assigned" branch and
    // therefore previews a wheel fixture with DmxColorWheelChannel=0 as
    // permanently full white.  Every xLights since 2024 defaults an ABSENT
    // wheel channel to 0 (and the 2026 migration writes the 0 out), so vendor
    // files that only set DmxDimmerChannel (e.g. RGBS's DmxMovingHead3D heads:
    // dimmer on ch3, no wheel channel) came out "always on" and the extracted
    // intensity track never went dark.  The physical fixture dims on that
    // channel regardless of the wheel, so honour it here.
    const wdc = c.wheelDimmerChannel ?? 0;
    if (checkChannel(channelData, wdc)) {
        const dim = readChannel(channelData, wdc) / 255.0;
        col = { r: Math.trunc(col.r * dim), g: Math.trunc(col.g * dim), b: Math.trunc(col.b * dim), w: col.w };
    }
    return col;
}

function readColorForward(channelData: Uint8Array, colorDef: MhColorDef): RGBColor {
    switch (colorDef.colorType) {
        case "RGBW":
            return readColorRGBW(channelData, colorDef);
        case "CMY":
            return readColorCMY(channelData, colorDef);
        case "ColorWheel":
            return readColorWheel(channelData, colorDef);
        default:
            // "None"/Unused = no color ability; xLights forces the beam white.
            return { r: 255, g: 255, b: 255, w: 0 };
    }
}

/**
 * Match a DMX value to a wheel color using xLights' three strategies
 * (DmxColorAbilityWheel::GetWheelColorFromDMXValue):
 *  (a) if any slot has dmxValue 0 → floor: highest slot value <= v wins;
 *  (b) else if any slot has dmxValue 255 → ceiling: lowest slot value >= v wins;
 *  (c) else → slot values are band midpoints: nearest wins (below-first → first,
 *      above-last → last).
 */
export function lookupColorWheel(entries: MhColorWheelEntry[], dmxValue: number): RGBColor {
    if (entries.length === 0) return { r: 255, g: 255, b: 255, w: 0 };

    const hasZero = entries.some(e => e.dmxValue === 0);
    const has255 = entries.some(e => e.dmxValue === 255);

    if (hasZero) {
        let best: MhColorWheelEntry | undefined;
        let bestVal = -1;
        for (const e of entries) {
            if (e.dmxValue <= dmxValue && e.dmxValue > bestVal) {
                best = e;
                bestVal = e.dmxValue;
            }
        }
        return best ? parseHexColor(best.color) : { r: 0, g: 0, b: 0, w: 0 };
    }

    if (has255) {
        let best: MhColorWheelEntry | undefined;
        let bestVal = 256;
        for (const e of entries) {
            if (e.dmxValue >= dmxValue && e.dmxValue < bestVal) {
                best = e;
                bestVal = e.dmxValue;
            }
        }
        return best ? parseHexColor(best.color) : { r: 0, g: 0, b: 0, w: 0 };
    }

    // Midpoint strategy on a sorted copy
    const sorted = [...entries].sort((a, b) => a.dmxValue - b.dmxValue);
    for (let i = 0; i < sorted.length; i++) {
        if (i === 0 && dmxValue <= sorted[i].dmxValue) {
            return parseHexColor(sorted[i].color);
        }
        if (i === sorted.length - 1) {
            return parseHexColor(sorted[i].color);
        }
        if (dmxValue >= sorted[i].dmxValue && dmxValue <= sorted[i + 1].dmxValue) {
            const mid = sorted[i].dmxValue + Math.trunc((sorted[i + 1].dmxValue - sorted[i].dmxValue) / 2);
            return parseHexColor(dmxValue <= mid ? sorted[i].color : sorted[i + 1].color);
        }
    }
    return parseHexColor(sorted[sorted.length - 1].color);
}

export function parseHexColor(hex: string): RGBColor {
    // Handle formats: "#RRGGBB", "RRGGBB", "#RGB"
    let h = hex.replace('#', '');
    if (h.length === 3) {
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    const val = parseInt(h, 16);
    if (isNaN(val)) return { r: 0, g: 0, b: 0, w: 0 };
    return {
        r: (val >> 16) & 0xFF,
        g: (val >> 8) & 0xFF,
        b: val & 0xFF,
        w: 0,
    };
}

// ============================================================================
// Dimmer & Shutter
// ============================================================================

function readDimmer(channelData: Uint8Array, dimmerDef: MhDimmerDef): number {
    if (dimmerDef.channel <= 0) return 1.0; // No dimmer channel = full on
    return readChannel(channelData, dimmerDef.channel) / 255.0;
}

function readShutter(channelData: Uint8Array, shutterDef: MhShutterDef): boolean {
    if (shutterDef.channel <= 0 || shutterDef.channel > channelData.length) return true;
    const val = readChannel(channelData, shutterDef.channel);
    // xLights: open iff value >= threshold.  (The "inverted" negative-threshold
    // branch upstream is dead code; a negative threshold is thus always-open,
    // which this comparison reproduces.)
    return val >= shutterDef.openThreshold;
}

// ============================================================================
// Slew simulation — commanded angles → displayed angles
//
// The xLights preview limits per-frame motion to SlewLimit deg/sec (scaled by
// the speed channel value/255 when one is assigned; speed 0 there means
// frozen).  A sequence that strobes the position channels (an authored
// "shiver") therefore displays as a small tremble, not a full-range flip —
// decoding raw commanded angles would wildly misrepresent such content.
// createMhSlewFilter replicates the preview behavior for sequential frame
// decoding.
// ============================================================================

export interface MhSlewFilter {
    /** Apply slew limiting to a decoded state (mutates and returns it).
     *  Call once per frame, in frame order.  channelData is the model's
     *  channel slice (for speed-channel reads). */
    apply(state: MhPhysicalState, channelData: Uint8Array): MhPhysicalState;
}

function slewAxis(
    prev: number | undefined,
    commanded: number,
    motor: MhMotorDef | undefined,
    channelData: Uint8Array,
    dtSec: number,
): number {
    if (prev === undefined || !motor) return commanded;
    let rate = motor.slewLimit;
    let speedScaled = false;
    const speedCh = motor.speedChannel ?? 0;
    if (speedCh > 0 && speedCh <= channelData.length) {
        rate *= readChannel(channelData, speedCh) / 255.0;
        speedScaled = true;
    }
    // SlewLimit 0 with no speed channel = instant (xLights); a speed channel
    // scaling the rate to 0 means "don't move".
    if (rate <= 0 && !speedScaled) return commanded;
    const maxDelta = rate * dtSec;
    const delta = commanded - prev;
    if (Math.abs(delta) <= maxDelta) return commanded;
    return prev + Math.sign(delta) * maxDelta;
}

/**
 * Create a slew filter for sequential per-frame decoding of one fixture.
 * The first frame passes through unchanged (xLights treats a >500ms state gap
 * as a jump, which covers sequence start).
 */
export function createMhSlewFilter(def: MhDefinition, msPerFrame: number): MhSlewFilter {
    const dtSec = msPerFrame / 1000;
    let prevPan: number | undefined;
    let prevTilt: number | undefined;
    return {
        apply(state: MhPhysicalState, channelData: Uint8Array): MhPhysicalState {
            const pan = slewAxis(prevPan, state.panAngle, def.panMotor, channelData, dtSec);
            const tilt = slewAxis(prevTilt, state.tiltAngle, def.tiltMotor, channelData, dtSec);
            prevPan = pan;
            prevTilt = tilt;
            state.panAngle = pan;
            state.tiltAngle = tilt;
            return state;
        },
    };
}

// ============================================================================
// Forward Engine: channels → physical state
// ============================================================================

/**
 * Convert channel data to physical state for a moving head fixture.
 * channelData is the model's DMX channel values (index 0 = channel 1).
 */
export function mhChannelsToState(def: MhDefinition, channelData: Uint8Array): MhPhysicalState {
    const panAngle = def.panMotor ? readMotorAngle(channelData, def.panMotor) : 0;
    const tiltAngle = def.tiltMotor ? readMotorAngle(channelData, def.tiltMotor) : 0;
    const color = readColorForward(channelData, def.color);
    const dimmer = readDimmer(channelData, def.dimmer);
    const shutterOpen = readShutter(channelData, def.shutter);

    return {
        panAngle,
        tiltAngle,
        r: color.r,
        g: color.g,
        b: color.b,
        w: color.w,
        dimmer,
        shutterOpen,
    };
}

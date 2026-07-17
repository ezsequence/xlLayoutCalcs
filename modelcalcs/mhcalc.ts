// Moving Head Calculation Engine
// Forward: channel data → physical state
// Reverse: physical state → channel data
// Pure math functions with no dependencies beyond basic JS.

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
// Angle convention (matches xLights DmxMotor):
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
    /** Red component 0-255. */
    r: number;
    /** Green component 0-255. */
    g: number;
    /** Blue component 0-255. */
    b: number;
    /** White component 0-255 (for RGBW fixtures). */
    w: number;
    /** Dimmer value 0.0-1.0. */
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

/**
 * Read a 16-bit or 8-bit motor value from channel data.
 */
function readMotorValue(channelData: Uint8Array, motor: MhMotorDef): number {
    const coarse = readChannel(channelData, motor.channelCoarse);
    if (motorIs16Bit(motor)) {
        const fine = readChannel(channelData, motor.channelFine);
        return (coarse << 8) | fine;
    }
    return coarse;
}

/**
 * xLights GetPosition formula:
 *   position = ((1 - (val - min) / (max - min)) * rev * ROM) - rev * ROM
 * Simplified (min=0): position = -rev * ROM * val / maxValue
 *
 * At channelValue=0 → 0°.  At channelValue=maxValue → -ROM (or +ROM if reversed).
 * orient_zero is added after to shift the reference frame into physical space.
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
 * Inverse of motorGetPosition: convert a physical angle to the channel value
 * that produces it.  Guaranteed round-trip:
 *   motorGetPosition(motor, motorPhysAngleToCmd(motor, angle)) ≈ angle
 * (within DMX quantization error).
 *
 * Note: xLights' ConvertPosToCmd uses orient_home (a separate parameter) and
 * is NOT the mathematical inverse of GetPosition.  This function uses only
 * orient_zero, matching the DmxMovingHeadAdv rendering path exactly.
 */
export function motorPhysAngleToCmd(motor: MhMotorDef, physAngle: number): number {
    const maxVal = motorMaxValue(motor);
    const rev = motor.reverse ? -1 : 1;

    // Clamp to commandable physical range (respects motor limits).
    // motorConvertPosToCmd clamps "position" to [minLimit, maxLimit]
    // where position = orientZero − physAngle, so:
    //   orientZero − maxLimit  ≤  physAngle  ≤  orientZero − minLimit
    const physLo = motor.orientZero - motor.maxLimit;
    const physHi = motor.orientZero - motor.minLimit;
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

    return Math.round(Math.max(0, Math.min(maxVal, cv)));
}

// ============================================================================
// Color Forward: channel data → RGB
// ============================================================================

export interface RGBColor {
    r: number;
    g: number;
    b: number;
    w: number;
}

function readColorForward(channelData: Uint8Array, colorDef: MhColorDef): RGBColor {
    switch (colorDef.colorType) {
        case "RGBW": {
            return {
                r: readChannel(channelData, colorDef.redChannel),
                g: readChannel(channelData, colorDef.greenChannel),
                b: readChannel(channelData, colorDef.blueChannel),
                w: readChannel(channelData, colorDef.whiteChannel),
            };
        }
        case "CMY": {
            const c = readChannel(channelData, colorDef.redChannel);   // C channel
            const m = readChannel(channelData, colorDef.greenChannel); // M channel
            const y = readChannel(channelData, colorDef.blueChannel);  // Y channel
            return {
                r: 255 - c,
                g: 255 - m,
                b: 255 - y,
                w: 0,
            };
        }
        case "ColorWheel": {
            const wheelVal = readChannel(channelData, colorDef.colorWheelChannel);
            const color = lookupColorWheel(colorDef.colorWheelEntries, wheelVal);
            return color;
        }
        default:
            // "None" = no color mixing channels; fixture emits white when powered.
            // (CMY already handles this correctly via complement math.)
            return { r: 255, g: 255, b: 255, w: 0 };
    }
}

function lookupColorWheel(entries: MhColorWheelEntry[], dmxValue: number): RGBColor {
    if (entries.length === 0) return { r: 0, g: 0, b: 0, w: 0 };

    // Find the closest entry by DMX value
    let closest = entries[0];
    let closestDist = Math.abs(dmxValue - closest.dmxValue);
    for (let i = 1; i < entries.length; i++) {
        const dist = Math.abs(dmxValue - entries[i].dmxValue);
        if (dist < closestDist) {
            closest = entries[i];
            closestDist = dist;
        }
    }

    return parseHexColor(closest.color);
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
    if (shutterDef.channel <= 0) return true; // No shutter channel = always open
    const val = readChannel(channelData, shutterDef.channel);
    return val >= shutterDef.openThreshold;
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

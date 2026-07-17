// Moving Head Definition Types & Parser
// Defines the data model for DMX moving head fixtures and parses from xLights XML.

import { DmxModel } from "./dmx";
import { getOptionalElementByTag, getIntAttrDef, getNumAttrDef, getBoolAttrDef } from "./utils";

// ============================================================================
// Motor Definition
// ============================================================================

export interface MhMotorDef {
    /** 1-based DMX channel for coarse (MSB) value. 0 = not assigned. */
    channelCoarse: number;
    /** 1-based DMX channel for fine (LSB) value. 0 = no fine channel (8-bit). */
    channelFine: number;
    /** Total physical range of motion in degrees. */
    rangeOfMotion: number;
    /** Home orientation offset in degrees (used in reverse to compute DMX command). */
    orientHome: number;
    /** Zero orientation offset in degrees (added after forward position calc). */
    orientZero: number;
    /** Minimum allowed position in degrees. */
    minLimit: number;
    /** Maximum allowed position in degrees. */
    maxLimit: number;
    /** If true, reverses rotation direction. */
    reverse: boolean;
    /** If true, negates position before computing command. */
    upsideDown: boolean;
    /** Maximum angular velocity in degrees/second. 0 = unlimited. */
    slewLimit: number;
}

/** True if this motor uses 16-bit (coarse+fine) resolution. */
export function motorIs16Bit(motor: MhMotorDef): boolean {
    return motor.channelFine > 0;
}

/** Maximum raw channel value (65535 for 16-bit, 255 for 8-bit). */
export function motorMaxValue(motor: MhMotorDef): number {
    return motorIs16Bit(motor) ? 65535 : 255;
}

// ============================================================================
// Color Definition
// ============================================================================

export type MhColorType = "RGBW" | "CMY" | "ColorWheel" | "None";

export interface MhColorWheelEntry {
    index: number;
    dmxValue: number;
    color: string; // hex color string e.g. "#FF0000"
}

export interface MhColorDef {
    colorType: MhColorType;
    /** RGB/RGBW channel assignments (1-based, 0 = not assigned) */
    redChannel: number;
    greenChannel: number;
    blueChannel: number;
    whiteChannel: number;
    /** Color wheel channel (1-based, 0 = not assigned) */
    colorWheelChannel: number;
    /** Color wheel entries (index → dmx value + color) */
    colorWheelEntries: MhColorWheelEntry[];
}

// ============================================================================
// Dimmer & Shutter Definitions
// ============================================================================

export interface MhDimmerDef {
    /** 1-based DMX channel. 0 = not assigned. */
    channel: number;
}

export interface MhShutterDef {
    /** 1-based DMX channel. 0 = not assigned. */
    channel: number;
    /** DMX value at or above which shutter is considered open. */
    openThreshold: number;
    /** DMX value written when shutter should be on/open. */
    onValue: number;
}

// ============================================================================
// Composite MH Definition
// ============================================================================

export interface MhDefinition {
    name: string;
    numChannels: number;
    panMotor: MhMotorDef | undefined;
    tiltMotor: MhMotorDef | undefined;
    color: MhColorDef;
    dimmer: MhDimmerDef;
    shutter: MhShutterDef;
}

// ============================================================================
// Parser
// ============================================================================

function parseMotorElement(el: Element): MhMotorDef {
    const rangeOfMotion = getNumAttrDef(el, 'RangeOfMotion', 180.0);
    // Default limits span the full ROM so the planner can exploit wrap-around.
    // xLights hardcodes ±180 but that wastes the DP's ability to disambiguate
    // aliases on motors with >360° ROM.
    const defaultLimit = Math.round(rangeOfMotion / 2);
    return {
        channelCoarse: getIntAttrDef(el, 'ChannelCoarse', 0),
        channelFine: getIntAttrDef(el, 'ChannelFine', 0),
        rangeOfMotion,
        orientHome: getIntAttrDef(el, 'OrientHome', 0),
        orientZero: getIntAttrDef(el, 'OrientZero', 0),
        minLimit: getIntAttrDef(el, 'MinLimit', -defaultLimit),
        maxLimit: getIntAttrDef(el, 'MaxLimit', defaultLimit),
        reverse: getBoolAttrDef(el, 'Reverse', false),
        upsideDown: getBoolAttrDef(el, 'UpsideDown', false),
        slewLimit: getNumAttrDef(el, 'SlewLimit', 0),
    };
}

function resolveColorType(dmxColorType: string): MhColorType {
    if (!dmxColorType) return "None";
    // Handle numeric enum values (xLights DMX_COLOR_TYPES: 0=RGBW, 1=Wheel, 2=CMYW)
    if (dmxColorType === "0") return "RGBW";
    if (dmxColorType === "1") return "ColorWheel";
    if (dmxColorType === "2") return "CMY";
    const ct = dmxColorType.toLowerCase();
    if (ct === "rgbw" || ct === "rgb") return "RGBW";
    if (ct === "cmy" || ct === "cmyw") return "CMY";
    if (ct === "colorwheel" || ct === "color wheel") return "ColorWheel";
    return "None";
}

/**
 * Parse an MhDefinition from a DmxModel and its source XML element.
 * The XML element is the model element from xlights_rgbeffects.xml.
 */
export function parseMhDefinition(model: DmxModel, xml: Element): MhDefinition {
    // Parse motor child elements
    const panEl = getOptionalElementByTag(xml, 'PanMotor');
    const tiltEl = getOptionalElementByTag(xml, 'TiltMotor');

    const panMotor = panEl ? parseMotorElement(panEl) : undefined;
    const tiltMotor = tiltEl ? parseMotorElement(tiltEl) : undefined;

    // Build color def from already-parsed DmxModel properties
    // Infer RGBW when color type is unset but RGB channels are assigned
    let colorType = resolveColorType(model.dmxColorType);
    if (colorType === "None" && (model.dmxRedChannel > 0 || model.dmxGreenChannel > 0 || model.dmxBlueChannel > 0)) {
        colorType = "RGBW";
    }
    const colorWheelEntries: MhColorWheelEntry[] = [];
    if (colorType === "ColorWheel") {
        for (const [idx, dmxVal] of model.colorWheelDMX) {
            const colorStr = model.colorWheelColors.get(idx) || "#000000";
            colorWheelEntries.push({ index: idx, dmxValue: dmxVal, color: colorStr });
        }
        // Sort by DMX value for nearest-match lookups
        colorWheelEntries.sort((a, b) => a.dmxValue - b.dmxValue);
    }

    const color: MhColorDef = {
        colorType,
        redChannel: model.dmxRedChannel,
        greenChannel: model.dmxGreenChannel,
        blueChannel: model.dmxBlueChannel,
        whiteChannel: model.dmxWhiteChannel,
        colorWheelChannel: model.dmxColorWheelChannel,
        colorWheelEntries,
    };

    // Dimmer: prefer MhDimmerChannel, fall back to DmxDimmerChannel
    const dimmerChannel = model.mhDimmerChannel || model.dmxDimmerChannel;
    const dimmer: MhDimmerDef = { channel: dimmerChannel };

    // Shutter
    const shutter: MhShutterDef = {
        channel: model.dmxShutterChannel,
        openThreshold: model.dmxShutterOpen,
        onValue: model.dmxShutterOnValue,
    };

    return {
        name: model.name,
        numChannels: model.numChannels,
        panMotor,
        tiltMotor,
        color,
        dimmer,
        shutter,
    };
}

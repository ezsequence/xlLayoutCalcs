// Moving Head Definition Types & Parser
// Defines the data model for DMX moving head fixtures and parses from xLights XML.
//
// Ground truth: xLights src-core/models/DMX (DmxMotor, DmxColorAbility*,
// DmxShutterAbility, DmxMovingHead[Adv]) and the 2024 legacy migration
// (ModelManager::MigrateDmxMotors).  See doc/MovingHeadModel.md.

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
    /** Home orientation offset in degrees (used only by xLights' effect-side
     *  ConvertPosToCmd, never by the preview). */
    orientHome: number;
    /** Zero orientation offset in degrees (added after forward position calc).
     *  NOTE: for legacy DmxMovingHead display semantics this is stored already
     *  negated (see parseMhDefinition) so the Adv-convention forward formula
     *  reproduces the legacy preview. */
    orientZero: number;
    /** Minimum allowed position in degrees. */
    minLimit: number;
    /** Maximum allowed position in degrees. */
    maxLimit: number;
    /** If true, reverses rotation direction.  May be pre-flipped for legacy
     *  display semantics (see parseMhDefinition). */
    reverse: boolean;
    /** If true, negates position before computing command. */
    upsideDown: boolean;
    /** Maximum angular velocity in degrees/second. 0 = unlimited. */
    slewLimit: number;
    /** 1-based DMX channel scaling the slew rate (val/255). 0/absent = none.
     *  xLights: speed 0 on an assigned channel means frozen. */
    speedChannel?: number;
}

/** True if this motor uses 16-bit (coarse+fine) resolution. */
export function motorIs16Bit(motor: MhMotorDef): boolean {
    return motor.channelFine > 0;
}

/**
 * Maximum raw channel value.  xLights always divides by 65535: an 8-bit motor's
 * coarse byte is shifted up (v << 8, max 65280), a 16-bit motor combines
 * (c << 8) | f (max 65535).  See mhcalc.readMotorValue which produces the
 * matching raw values.
 */
export function motorMaxValue(_motor: MhMotorDef): number {
    return 65535;
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
    /** RGB/RGBW channel assignments (1-based, 0 = not assigned).
     *  For CMY fixtures these hold the Cyan/Magenta/Yellow channels
     *  (from DmxCyanChannel etc.). */
    redChannel: number;
    greenChannel: number;
    blueChannel: number;
    /** White channel — used by both RGBW and CMYW ("white wins" when non-zero). */
    whiteChannel: number;
    /** Color wheel channel (1-based, 0 = not assigned) */
    colorWheelChannel: number;
    /** The color wheel ability's own dimmer channel (XML attr DmxDimmerChannel).
     *  Applied inside GetBeamColor by xLights, in ADDITION to the model-level
     *  dimmer (MhDimmerChannel).  0 = none. */
    wheelDimmerChannel?: number;
    /** Milliseconds for the physical wheel to travel one slot (Auto Shutter). */
    wheelDelayMs?: number;
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
    /** DMX value at or above which shutter is considered open.
     *  Negative = effectively always open (xLights' inverted branch is dead code). */
    openThreshold: number;
    /** DMX value written when shutter should be on/open. */
    onValue: number;
}

// ============================================================================
// Presets (fixed channels)
// ============================================================================

export interface MhPresetEntry {
    /** 1-based DMX channel. */
    channel: number;
    /** Value forced onto the channel on every effect write (0 not representable). */
    value: number;
    description: string;
}

// ============================================================================
// Composite MH Definition
// ============================================================================

export interface MhDefinition {
    name: string;
    numChannels: number;
    /** The xLights DisplayAs this definition was parsed from (after style
     *  normalization): "DmxMovingHead" | "DmxMovingHeadAdv" | "DmxMovingHead3D". */
    displayAs?: string;
    panMotor: MhMotorDef | undefined;
    tiltMotor: MhMotorDef | undefined;
    color: MhColorDef;
    dimmer: MhDimmerDef;
    shutter: MhShutterDef;
    presets?: MhPresetEntry[];
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Normalize a motor definition:
 *  - Negative RangeOfMotion is a legacy idiom for "reversed" (pre-Reverse-flag
 *    files used DmxPanDegOfRot="-540"; the 2024 migration copies it verbatim).
 *    Algebraically -ROM ≡ |ROM| with reverse flipped, so fold it.
 *  - Swap inverted limits (an artifact of deriving default limits from a
 *    negative ROM, or of hand-edited files).
 * Exported so stale pre-normalization data (e.g. older inventory JSON) can be
 * repaired before linting/planning.
 */
export function normalizeMhMotorDef(m: MhMotorDef): MhMotorDef {
    let out = m;
    if (out.rangeOfMotion < 0) {
        out = { ...out, rangeOfMotion: -out.rangeOfMotion, reverse: !out.reverse };
    }
    if (out.minLimit > out.maxLimit) {
        out = { ...out, minLimit: out.maxLimit, maxLimit: out.minLimit };
    }
    return out;
}

function parseMotorElement(el: Element): MhMotorDef {
    const rangeOfMotion = getNumAttrDef(el, 'RangeOfMotion', 180.0);
    // Default limits span the full ROM so the planner can exploit wrap-around.
    // xLights hardcodes ±180 but that wastes the DP's ability to disambiguate
    // aliases on motors with >360° ROM.
    const defaultLimit = Math.round(Math.abs(rangeOfMotion) / 2);
    return normalizeMhMotorDef({
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
        speedChannel: getIntAttrDef(el, 'SpeedChannel', 0),
    });
}

/**
 * Synthesize a motor definition from legacy flat attributes, replicating
 * xLights 2024's ModelManager::MigrateDmxMotors:
 *   ChannelCoarse = Dmx{Pan|Tilt}Channel   (default 1)
 *   RangeOfMotion = Dmx{Pan|Tilt}DegOfRot  (default 540 pan / 180 tilt)
 *   SlewLimit     = Dmx{Pan|Tilt}SlewLimit (default 180)
 *   OrientZero    = (360 - Dmx{Pan|Tilt}Orient) % 360
 * No fine channel, Reverse false, OrientHome 0, limits ±ROM/2 (we widen from
 * xLights' ±180 for the same planner reason as parseMotorElement).
 */
function synthesizeLegacyMotor(xml: Element, axis: 'Pan' | 'Tilt'): MhMotorDef {
    const romDefault = axis === 'Pan' ? 540 : 180;
    const rangeOfMotion = getNumAttrDef(xml, `Dmx${axis}DegOfRot`, romDefault);
    let orientZero = (360 - getIntAttrDef(xml, `Dmx${axis}Orient`, 0)) % 360;
    if (orientZero === 360) orientZero = 0;
    const defaultLimit = Math.round(Math.abs(rangeOfMotion) / 2);
    return normalizeMhMotorDef({
        channelCoarse: getIntAttrDef(xml, `Dmx${axis}Channel`, 1),
        channelFine: 0,
        rangeOfMotion,
        orientHome: 0,
        orientZero,
        minLimit: -defaultLimit,
        maxLimit: defaultLimit,
        reverse: false,
        upsideDown: false,
        slewLimit: getNumAttrDef(xml, `Dmx${axis}SlewLimit`, 180),
        speedChannel: 0,
    });
}

/**
 * Fold legacy DmxMovingHead display semantics into a motor definition.
 * The legacy model computes angle = -GetPosition(v) - orientZero while the
 * Adv model (our engine's convention) computes +GetPosition(v) + orientZero.
 * Flipping reverse and negating orientZero makes the Adv formula reproduce
 * the legacy angle exactly:
 *   -(-rev*ROM*f + oz) = (-(-rev))*ROM*f*(-1) + (-oz)
 */
function foldLegacySign(motor: MhMotorDef): MhMotorDef {
    // Negate orientZero.  The legacy angle is also mirrored relative to the
    // effect position (physAngle = −oz + rev·home + pos rather than
    // oz − rev·home − pos), so mirror the limits too: motorLimitWindow then
    // yields the same physical window the legacy fixture actually commands.
    let oz = -motor.orientZero;
    // Normalize to (-180, 180] for sane planner windows
    while (oz <= -180) oz += 360;
    while (oz > 180) oz -= 360;
    return {
        ...motor, reverse: !motor.reverse, orientZero: oz,
        minLimit: -motor.maxLimit, maxLimit: -motor.minLimit,
    };
}

function resolveColorType(dmxColorType: string): MhColorType {
    // xLights DMX_COLOR_TYPES: 0=RGBW, 1=ColorWheel, 2=CMYW, 3=Unused.
    // The XML attribute defaults to "0" (RGBW) when absent.
    if (!dmxColorType) return "RGBW";
    if (dmxColorType === "0") return "RGBW";
    if (dmxColorType === "1") return "ColorWheel";
    if (dmxColorType === "2") return "CMY";
    if (dmxColorType === "3") return "None";
    const ct = dmxColorType.toLowerCase();
    if (ct === "rgbw" || ct === "rgb") return "RGBW";
    if (ct === "cmy" || ct === "cmyw") return "CMY";
    if (ct === "colorwheel" || ct === "color wheel") return "ColorWheel";
    if (ct === "unused" || ct === "none") return "None";
    return "RGBW";
}

/** xLights legacy DmxStyle values that identify a moving head. */
export function isMovingHeadDmxStyle(style: string): boolean {
    return style.startsWith('Moving Head');
}

/**
 * True when a definition has at least one commandable pan or tilt motor — i.e.
 * it is a REAL moving head with a beam trajectory, not a motorless DMX device
 * (fog machine, fountain, snow machine, laser, flood) that a user happened to
 * build using a DmxMovingHead* model type.  Motorless devices have no beam
 * direction to decode or replicate, so the moving-head timing-track and mapping
 * paths must exclude them.
 */
export function mhDefinitionHasMotors(def: MhDefinition): boolean {
    return (def.panMotor?.channelCoarse ?? 0) > 0
        || (def.tiltMotor?.channelCoarse ?? 0) > 0;
}

/**
 * Parse an MhDefinition from a DmxModel and its source XML element.
 * The XML element is the model element from xlights_rgbeffects.xml (or an
 * .xmodel root).  `displayAs` selects the interpretation:
 *   - "DmxMovingHeadAdv": modern semantics, motors from PanMotor/TiltMotor.
 *   - "DmxMovingHead": legacy display semantics (negated angles); motors from
 *     PanMotor/TiltMotor elements when present, else synthesized from legacy
 *     flat attributes (MigrateDmxMotors).
 *   - "DmxMovingHead3D": old files only — xLights converts these to Adv with
 *     motors synthesized from legacy attributes (Adv sign convention).
 *   - "DMX" with DmxStyle "Moving Head *": treated as DmxMovingHead.
 */
export function parseMhDefinition(model: DmxModel, xml: Element, displayAsIn?: string): MhDefinition {
    let displayAs = displayAsIn ?? xml.getAttribute('DisplayAs') ?? 'DmxMovingHeadAdv';
    if (displayAs === 'DMX') displayAs = 'DmxMovingHead';

    // Parse motor child elements
    const panEl = getOptionalElementByTag(xml, 'PanMotor');
    const tiltEl = getOptionalElementByTag(xml, 'TiltMotor');

    const hasLegacyAttrs =
        xml.hasAttribute('DmxPanChannel') || xml.hasAttribute('DmxTiltChannel') ||
        xml.hasAttribute('DmxPanDegOfRot') || xml.hasAttribute('DmxTiltDegOfRot');

    let panMotor = panEl ? parseMotorElement(panEl) : undefined;
    let tiltMotor = tiltEl ? parseMotorElement(tiltEl) : undefined;

    // Legacy synthesis when motor elements are absent (old files / xmodels)
    if (!panMotor && hasLegacyAttrs) panMotor = synthesizeLegacyMotor(xml, 'Pan');
    if (!tiltMotor && hasLegacyAttrs) tiltMotor = synthesizeLegacyMotor(xml, 'Tilt');

    // Legacy DmxMovingHead renders with negated angle semantics — fold into
    // the motor definition so the (Adv-convention) forward engine matches.
    if (displayAs === 'DmxMovingHead') {
        if (panMotor) panMotor = foldLegacySign(panMotor);
        if (tiltMotor) tiltMotor = foldLegacySign(tiltMotor);
    }

    // Build color def from already-parsed DmxModel properties.
    const colorType = resolveColorType(model.dmxColorType);

    const colorWheelEntries: MhColorWheelEntry[] = [];
    if (colorType === "ColorWheel") {
        // xLights reads pairs 0..24 and stops at the first index where either
        // attribute is missing.  (Also accept entries from the pre-parsed
        // DmxModel maps for callers that construct models directly.)
        for (let i = 0; i < 25; i++) {
            const hasAttr = xml.hasAttribute(`DmxColorWheelDMX${i}`) && xml.hasAttribute(`DmxColorWheelColor${i}`);
            const hasMap = model.colorWheelDMX.has(i) && model.colorWheelColors.has(i);
            if (!hasAttr && !hasMap) break;
            colorWheelEntries.push({
                index: i,
                dmxValue: model.colorWheelDMX.get(i) ?? getIntAttrDef(xml, `DmxColorWheelDMX${i}`, 1),
                color: model.colorWheelColors.get(i) || xml.getAttribute(`DmxColorWheelColor${i}`) || "#000000",
            });
        }
        // wx-era xLights falls back to a default 4-slot wheel when a fixture
        // defines none (DmxColorAbilityWheel::InitColor).
        if (colorWheelEntries.length === 0) {
            colorWheelEntries.push(
                { index: 0, dmxValue: 10, color: "#ffffff" },
                { index: 1, dmxValue: 30, color: "#ff0000" },
                { index: 2, dmxValue: 50, color: "#00ff00" },
                { index: 3, dmxValue: 70, color: "#0000ff" },
            );
        }
    }

    // Channel defaults mirror xLights' deserializer:
    //   RGBW: R=1 G=2 B=3 W=0;  CMYW: C=1 M=2 Y=3 W=0 (from DmxCyan/Magenta/Yellow)
    // An attribute explicitly present (even "0") wins; else a non-zero value
    // on the pre-parsed model; else the xLights default.
    const attrOr = (name: string, modelVal: number, dflt: number) =>
        xml.hasAttribute(name) ? getIntAttrDef(xml, name, dflt) : (modelVal || dflt);

    let redChannel = 0, greenChannel = 0, blueChannel = 0, whiteChannel = 0;
    if (colorType === "RGBW") {
        redChannel = attrOr('DmxRedChannel', model.dmxRedChannel, 1);
        greenChannel = attrOr('DmxGreenChannel', model.dmxGreenChannel, 2);
        blueChannel = attrOr('DmxBlueChannel', model.dmxBlueChannel, 3);
        whiteChannel = attrOr('DmxWhiteChannel', model.dmxWhiteChannel, 0);
    } else if (colorType === "CMY") {
        redChannel = attrOr('DmxCyanChannel', model.dmxCyanChannel, 1);
        greenChannel = attrOr('DmxMagentaChannel', model.dmxMagentaChannel, 2);
        blueChannel = attrOr('DmxYellowChannel', model.dmxYellowChannel, 3);
        whiteChannel = attrOr('DmxWhiteChannel', model.dmxWhiteChannel, 0);
    }

    // Wheel channel defaults: the wx-era xLights users run defaults an ABSENT
    // DmxColorWheelChannel to 1 and the wheel's DmxDimmerChannel to 2 (the
    // 2026 src-core port changed both to 0 — a regression that would render
    // every default-configured wheel fixture permanently white).  An explicit
    // "0" stays 0.
    const color: MhColorDef = {
        colorType,
        redChannel,
        greenChannel,
        blueChannel,
        whiteChannel,
        colorWheelChannel: colorType === "ColorWheel" ? attrOr('DmxColorWheelChannel', model.dmxColorWheelChannel, 1) : 0,
        wheelDimmerChannel: colorType === "ColorWheel" ? attrOr('DmxDimmerChannel', model.dmxDimmerChannel, 2) : 0,
        wheelDelayMs: model.dmxColorWheelDelay,
        colorWheelEntries,
    };

    // Model-level dimmer: MhDimmerChannel is the modern attribute.  For
    // non-wheel fixtures fall back to legacy DmxDimmerChannel (pre-rename
    // files); for wheel fixtures DmxDimmerChannel is the wheel's own dimmer
    // and must NOT be double-counted here.
    const dimmerChannel = model.mhDimmerChannel
        || (colorType === "ColorWheel" ? 0 : model.dmxDimmerChannel);
    const dimmer: MhDimmerDef = { channel: dimmerChannel };

    // Shutter
    const shutter: MhShutterDef = {
        channel: model.dmxShutterChannel,
        openThreshold: model.dmxShutterOpen,
        onValue: model.dmxShutterOnValue,
    };

    // Presets (fixed channels): DmxPresetChannel/Value/Desc i, stop at first
    // index with neither channel nor value (mirroring xLights' 25-slot cap).
    const presets: MhPresetEntry[] = [];
    for (let i = 0; i < 25; i++) {
        const chA = `DmxPresetChannel${i}`;
        const valA = `DmxPresetValue${i}`;
        if (!xml.hasAttribute(chA) && !xml.hasAttribute(valA)) break;
        const channel = getIntAttrDef(xml, chA, 0);
        const value = getIntAttrDef(xml, valA, 0);
        const description = xml.getAttribute(`DmxPresetDesc${i}`) ?? '';
        if (channel > 0 && value > 0) {
            presets.push({ channel, value, description });
        }
    }

    return {
        name: model.name,
        numChannels: model.numChannels,
        displayAs,
        panMotor,
        tiltMotor,
        color,
        dimmer,
        shutter,
        presets,
    };
}

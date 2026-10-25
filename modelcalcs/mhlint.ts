// Moving Head Fixture Linter
// Static sanity checks of an MhDefinition: self-contradictory channel
// assignments, configurations that can never emit (or never stop emitting)
// light, and xLights preview traps.  Pure — no I/O.
//
// Severities:
//   error   — the fixture cannot work as defined (in xLights and/or our engine)
//   warning — it works but will surprise the user (double-dim, stuck preview…)
//   info    — worth knowing; not a defect by itself

import { MhDefinition, MhMotorDef } from "./mhdef";
import { parseHexColor, RGBColor } from "./mhcalc";

function parseHexColorSafe(hex: string): RGBColor {
    try {
        return parseHexColor(hex ?? '');
    } catch {
        return { r: 0, g: 0, b: 0, w: 0 };
    }
}

export interface MhLintFinding {
    severity: 'error' | 'warning' | 'info';
    code: string;
    message: string;
}

interface RoleRef {
    channel: number;
    role: string;
    /** Roles in the same exclusivity group may share a channel. */
    shareGroup?: string;
}

function motorRoles(motor: MhMotorDef | undefined | null, axis: string): RoleRef[] {
    if (!motor) return [];
    const roles: RoleRef[] = [];
    if (motor.channelCoarse > 0) roles.push({ channel: motor.channelCoarse, role: `${axis} coarse` });
    if (motor.channelFine > 0) roles.push({ channel: motor.channelFine, role: `${axis} fine` });
    const speed = motor.speedChannel ?? 0;
    if (speed > 0) roles.push({ channel: speed, role: `${axis} speed` });
    return roles;
}

/**
 * Lint a moving head fixture definition.
 * Tolerates definitions parsed by older versions of mhdef (missing
 * speedChannel / wheelDimmerChannel / presets fields).
 */
export function lintMhDefinition(def: MhDefinition): MhLintFinding[] {
    const findings: MhLintFinding[] = [];
    const err = (code: string, message: string) => findings.push({ severity: 'error', code, message });
    const warn = (code: string, message: string) => findings.push({ severity: 'warning', code, message });
    const info = (code: string, message: string) => findings.push({ severity: 'info', code, message });

    const n = def.numChannels;
    const presets = def.presets ?? [];
    const color = def.color;
    const wheelDimmer = color.wheelDimmerChannel ?? 0;

    if (n <= 0) {
        err('mh_no_channels', `fixture has ${n} channels`);
        return findings;
    }

    // ---- Collect active roles --------------------------------------------
    const roles: RoleRef[] = [
        ...motorRoles(def.panMotor, 'pan'),
        ...motorRoles(def.tiltMotor, 'tilt'),
    ];
    switch (color.colorType) {
        case 'RGBW':
            if (color.redChannel > 0) roles.push({ channel: color.redChannel, role: 'red' });
            if (color.greenChannel > 0) roles.push({ channel: color.greenChannel, role: 'green' });
            if (color.blueChannel > 0) roles.push({ channel: color.blueChannel, role: 'blue' });
            if (color.whiteChannel > 0) roles.push({ channel: color.whiteChannel, role: 'white' });
            break;
        case 'CMY':
            if (color.redChannel > 0) roles.push({ channel: color.redChannel, role: 'cyan' });
            if (color.greenChannel > 0) roles.push({ channel: color.greenChannel, role: 'magenta' });
            if (color.blueChannel > 0) roles.push({ channel: color.blueChannel, role: 'yellow' });
            if (color.whiteChannel > 0) roles.push({ channel: color.whiteChannel, role: 'white' });
            break;
        case 'ColorWheel':
            if (color.colorWheelChannel > 0) roles.push({ channel: color.colorWheelChannel, role: 'color wheel' });
            if (wheelDimmer > 0) roles.push({ channel: wheelDimmer, role: 'wheel dimmer', shareGroup: 'dim' });
            break;
    }
    if (def.dimmer.channel > 0) roles.push({ channel: def.dimmer.channel, role: 'dimmer', shareGroup: 'dim' });
    if (def.shutter.channel > 0) roles.push({ channel: def.shutter.channel, role: 'shutter', shareGroup: 'dim' });

    // ---- Channel range ----------------------------------------------------
    for (const r of roles) {
        if (r.channel > n) {
            err('mh_channel_out_of_range',
                `${r.role} is on channel ${r.channel} but the model only has ${n} channels — xLights draws the model as invalid (and an unpatched xLights hangs on layout open for a DmxMovingHeadAdv assigned this way)`);
        }
    }
    for (const p of presets) {
        if (p.channel > n) {
            warn('mh_preset_out_of_range', `preset on channel ${p.channel} exceeds the ${n}-channel model`);
        }
    }

    // ---- Role conflicts ---------------------------------------------------
    const byChannel = new Map<number, RoleRef[]>();
    for (const r of roles) {
        if (r.channel <= 0 || r.channel > n) continue;
        const list = byChannel.get(r.channel) ?? [];
        list.push(r);
        byChannel.set(r.channel, list);
    }
    const colorRoles = new Set(['red', 'green', 'blue', 'white', 'cyan', 'magenta', 'yellow']);
    const motorRoleNames = new Set(['pan coarse', 'pan fine', 'tilt coarse', 'tilt fine']);
    const hasMotors = (def.panMotor?.channelCoarse ?? 0) > 0 || (def.tiltMotor?.channelCoarse ?? 0) > 0;
    const rgbAllSame = color.colorType === 'RGBW'
        && color.redChannel > 0
        && color.redChannel === color.greenChannel && color.greenChannel === color.blueChannel;

    for (const [ch, list] of byChannel) {
        if (list.length < 2) continue;
        // Sharing among the dimmer/shutter/wheel-dimmer group is a known
        // legitimate pattern (single-channel intensity+strobe).
        const allShareable = list.every(r => r.shareGroup === 'dim');
        if (allShareable) continue;

        const rolesHere = list.map(r => r.role);
        const nColor = rolesHere.filter(r => colorRoles.has(r)).length;
        const nMotor = rolesHere.filter(r => motorRoleNames.has(r)).length;
        const nDim = rolesHere.filter(r => r === 'dimmer' || r === 'wheel dimmer').length;
        const nShutter = rolesHere.filter(r => r === 'shutter').length;

        // R=G=B(+W) on one channel is a deliberate idiom: xLights reads it as
        // grey(v) — a single-channel intensity control.  Not a conflict.
        if (rgbAllSame && ch === color.redChannel && nMotor === 0 && nDim === 0 && nShutter === 0) {
            info('mh_color_single_channel',
                `channel ${ch} carries ${rolesHere.join(' + ')} — single-channel grey/intensity idiom (xLights shows grey(v))`);
            continue;
        }
        if (rgbAllSame && ch === color.redChannel && nMotor === 0 && nShutter > 0 && nDim === 0) {
            warn('mh_color_shutter_shared',
                `channel ${ch} is both the (single-channel) color and the shutter — value doubles as intensity and shutter gate; verify the open threshold (${def.shutter.openThreshold}) is below usable brightness`);
            continue;
        }
        if (nColor > 0 && nDim > 0 && nMotor === 0 && nShutter === 0) {
            warn('mh_color_dimmer_shared',
                `channel ${ch} carries ${rolesHere.join(' + ')} — the value drives color and dimmer together (squared brightness response in the preview)`);
            continue;
        }

        // Anything involving a motor channel, or other cross-role collisions,
        // is a genuine contradiction — unless the fixture has no motors at
        // all, in which case it's likely a non-MH device (fog/snow machine)
        // squeezed into an MH model type: downgrade to warning.
        const msg = `channel ${ch} is assigned to conflicting roles: ${rolesHere.join(' + ')}`;
        if (hasMotors && (nMotor > 0 || nColor + nDim + nShutter + nMotor >= 2)) {
            err('mh_role_conflict', msg);
        } else {
            warn('mh_role_conflict', msg);
        }
    }
    // Presets colliding with an active role: xLights forces the preset value
    // on every effect write, so the role is dead in rendering.
    for (const p of presets) {
        const clash = byChannel.get(p.channel);
        if (clash && clash.length > 0) {
            err('mh_preset_overrides_role',
                `preset value ${p.value} forces channel ${p.channel}, overriding its role (${clash.map(r => r.role).join(' + ')}) on every effect write`);
        }
    }

    // ---- Motors -----------------------------------------------------------
    for (const [motor, axis] of [[def.panMotor, 'pan'], [def.tiltMotor, 'tilt']] as [MhMotorDef | undefined, string][]) {
        if (!motor) continue;
        const hasChannel = motor.channelCoarse > 0 || motor.channelFine > 0;
        if (!hasChannel) continue;
        if (motor.channelCoarse > 0 && motor.channelCoarse === motor.channelFine) {
            err('mh_motor_coarse_eq_fine', `${axis} coarse and fine are both channel ${motor.channelCoarse}`);
        }
        if (motor.channelFine > 0 && motor.channelCoarse <= 0) {
            warn('mh_motor_fine_without_coarse', `${axis} has a fine channel (${motor.channelFine}) but no coarse channel`);
        }
        if (motor.rangeOfMotion === 0) {
            err('mh_motor_rom_invalid', `${axis} range of motion is 0° — the motor can't move and the position math divides by it`);
        } else if (motor.rangeOfMotion < 0) {
            // Legacy reverse idiom; parseMhDefinition normalizes it, so seeing
            // it here means stale pre-normalization data.  The derived limits
            // are inverted for the same reason — skip that check.
            info('mh_motor_rom_negative', `${axis} range of motion is ${motor.rangeOfMotion}° — legacy "reversed" idiom (normalized to |ROM| + reverse by the parser)`);
        }
        if (motor.rangeOfMotion > 0 && motor.minLimit >= motor.maxLimit) {
            err('mh_motor_limits_inverted', `${axis} limits are inverted/empty (min ${motor.minLimit} >= max ${motor.maxLimit})`);
        }
        if (motor.slewLimit < 0) {
            warn('mh_motor_slew_negative', `${axis} slew limit is negative (${motor.slewLimit})`);
        }
        if (motor.channelCoarse === n) {
            warn('mh_motor_coarse_last_channel',
                `${axis} coarse is the model's last channel (${n}) — an xLights preview bug reads it as 0, so the head appears stuck (the physical fixture still works)`);
        }
        if (motor.channelFine === n && motor.channelFine > 0) {
            warn('mh_motor_fine_last_channel',
                `${axis} fine is the model's last channel (${n}) — the xLights preview reads it as 0`);
        }
    }
    if (!def.panMotor?.channelCoarse && !def.tiltMotor?.channelCoarse) {
        info('mh_no_motors', 'no pan or tilt channel assigned — fixture is treated as static');
    }

    // ---- Shutter ----------------------------------------------------------
    const sh = def.shutter;
    const shutterInRange = sh.channel > 0 && sh.channel <= n;
    let shutterCanOpen = true;
    let shutterCanClose = false;
    if (shutterInRange) {
        if (sh.openThreshold > 255) {
            shutterCanOpen = false;
            err('mh_shutter_never_opens', `shutter open threshold ${sh.openThreshold} exceeds 255 — the shutter can never open`);
        }
        if (sh.openThreshold < 0) {
            info('mh_shutter_threshold_negative',
                `shutter threshold ${sh.openThreshold} is negative — xLights' inverted-shutter branch is dead code, so this means "always open"`);
        }
        if (sh.openThreshold <= 0) {
            info('mh_shutter_never_closes', `shutter threshold ${sh.openThreshold} ≤ 0 — every value opens the shutter, so it can never close`);
        } else {
            shutterCanClose = true;
        }
        if (sh.onValue > 0 && sh.openThreshold > 0 && sh.onValue < sh.openThreshold) {
            err('mh_shutter_onvalue_below_threshold',
                `Shutter On Value ${sh.onValue} is below the open threshold ${sh.openThreshold} — the value effects write to open the shutter doesn't open it`);
        }
        if (sh.onValue === 0 && sh.openThreshold > 0) {
            warn('mh_shutter_onvalue_zero',
                `shutter channel ${sh.channel} has Shutter On Value 0 — effects can't hold the shutter open (xLights warns about this too) and the beam may stay dark`);
        }
    }

    // ---- Dimmer -----------------------------------------------------------
    if (wheelDimmer > 0 && def.dimmer.channel > 0) {
        if (wheelDimmer === def.dimmer.channel) {
            // Extremely common: xLights shows two identically-labeled "Dimmer
            // Channel" fields (color wheel ability + dimmer ability) and users
            // naturally fill in both.  The preview dims by the square of the
            // value; the physical fixture dims once.  Info, not a user error.
            info('mh_double_dimmer_same_channel',
                `channel ${wheelDimmer} is set as both the wheel dimmer and the model dimmer (xLights shows two "Dimmer Channel" fields) — the xLights preview dims by the SQUARE of the value`);
        } else {
            warn('mh_double_dimmer',
                `both a wheel dimmer (ch ${wheelDimmer}) and a model dimmer (ch ${def.dimmer.channel}) are configured — xLights multiplies both into the preview`);
        }
    }

    // ---- Color / can-the-light-turn-on-and-off ---------------------------
    let canEmit = true;      // ∃ channel data with visible beam color
    let colorCanBlack = false; // ∃ channel data with beam color fully black
    switch (color.colorType) {
        case 'RGBW': {
            const hasRGB = color.redChannel > 0 && color.greenChannel > 0 && color.blueChannel > 0;
            const hasW = color.whiteChannel > 0 && color.whiteChannel <= n;
            if (hasRGB) {
                colorCanBlack = true; // all zero (incl. W) → black
            } else if (hasW) {
                colorCanBlack = true; // W=0 with incomplete RGB → beam (0,0,0)? No: W=0 & !hasRGB → grey(0) = black
            } else {
                info('mh_color_always_white',
                    'RGBW color type with no usable color channels — the xLights beam is permanently white (light can only be gated by shutter/dimmer)');
            }
            if ((color.redChannel > 0 || color.greenChannel > 0 || color.blueChannel > 0) && !hasRGB) {
                warn('mh_color_partial_rgb',
                    `only some of R/G/B are assigned (R=${color.redChannel} G=${color.greenChannel} B=${color.blueChannel}) — xLights ignores an incomplete RGB set`);
            }
            break;
        }
        case 'CMY': {
            const hasCMY = color.redChannel > 0 && color.greenChannel > 0 && color.blueChannel > 0;
            if (hasCMY) {
                colorCanBlack = true; // C=M=Y=0 → grey(0) = black (xLights' equal-CMY rule)
                info('mh_cmy_grey_rule',
                    'CMY fixture: note xLights renders C=M=Y=v as grey(v) — NOT subtractively — so all-zero flags show black, not white');
            } else if (color.whiteChannel > 0) {
                colorCanBlack = true;
            } else {
                info('mh_color_always_white', 'CMYW color type with no usable channels — beam permanently white');
            }
            break;
        }
        case 'ColorWheel': {
            const wheelUsable = color.colorWheelChannel > 0 && color.colorWheelChannel <= n
                && color.colorWheelEntries.length > 0;
            if (color.colorWheelChannel > 0 && color.colorWheelEntries.length === 0) {
                warn('mh_wheel_no_entries', 'color wheel channel assigned but the wheel has no colors — xLights treats the beam as always white');
            }
            if (color.colorWheelChannel <= 0) {
                info('mh_wheel_no_channel', 'ColorWheel color type but no wheel channel — beam always white');
            }
            if (wheelUsable) {
                const parsed = color.colorWheelEntries.map(e => ({ e, c: parseHexColorSafe(e.color) }));
                const nonBlack = parsed.filter(p => p.c.r + p.c.g + p.c.b > 0);
                const black = parsed.filter(p => p.c.r + p.c.g + p.c.b === 0);
                if (nonBlack.length === 0) {
                    canEmit = false;
                    err('mh_wheel_all_black', 'every color wheel entry is black — the fixture can never emit light in the xLights preview');
                }
                if (black.length > 0) colorCanBlack = true;
                if (wheelDimmer > 0) colorCanBlack = true;
                // duplicate DMX values with different colors
                const seen = new Map<number, string>();
                for (const { e } of parsed) {
                    const prev = seen.get(e.dmxValue);
                    if (prev !== undefined && prev.toLowerCase() !== e.color.toLowerCase()) {
                        warn('mh_wheel_dupe_dmx', `two wheel entries share DMX value ${e.dmxValue} with different colors (${prev} vs ${e.color})`);
                    }
                    seen.set(e.dmxValue, e.color);
                }
            }
            break;
        }
        case 'None':
            info('mh_color_none', 'color type Unused — xLights forces the beam white; only shutter/dimmer can gate the light');
            break;
    }

    // Emission gating summary
    const dimmerUsable = def.dimmer.channel > 0 && def.dimmer.channel <= n;
    if (shutterInRange && !shutterCanOpen) {
        canEmit = false;
    }
    if (!canEmit) {
        err('mh_never_lit', 'no combination of channel values makes this fixture emit light in the xLights preview');
    }

    const canTurnOff = (shutterInRange && shutterCanClose) || dimmerUsable || (wheelDimmer > 0 && wheelDimmer <= n) || colorCanBlack;
    if (canEmit && !canTurnOff) {
        warn('mh_never_off',
            'no shutter, no dimmer, and the color model cannot reach black — there is no way to turn this fixture off (the xLights beam is permanently lit)');
    }

    return findings;
}

/** Convenience: format findings as human-readable lines with a name prefix. */
export function formatMhLintFindings(name: string, findings: MhLintFinding[]): string[] {
    return findings.map(f => `${f.severity.toUpperCase().padEnd(7)} ${name}: [${f.code}] ${f.message}`);
}

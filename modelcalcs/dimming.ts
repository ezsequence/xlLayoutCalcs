// Which of a moving head's channels carry light intensity (safe to scale) vs.
// which are control (motors, shutter, colour-wheel slot, presets).  This is the
// dimming-domain interpretation of an MH definition; getControllersAndModelChannels
// calls it to fill XlModelChannelInfo.noDimChannels so the fact record carries
// the classification without controllers.ts owning these rules.

import { MhDefinition } from './mhdef';

/**
 * Intensity (dimmable) channels of a moving head, as 1-based fixture channels.
 *
 * RGBW: the red/green/blue/white channels dim linearly and preserve hue, so
 * they are dimmable alongside the dimmer.  CMY is subtractive — scaling C/M/Y
 * toward zero brightens toward white rather than dimming — so only the dimmer
 * channel controls intensity there.  ColorWheel selects a slot on its position
 * channel (control, never dimmed); its wheel-dimmer carries the intensity.
 */
export function mhDimmableChannels(def: MhDefinition): Set<number> {
    const dimmable = new Set<number>();
    const add = (ch: number | undefined) => { if (ch && ch > 0) dimmable.add(ch); };
    const c = def.color;
    if (c.colorType === 'RGBW') {
        add(c.redChannel); add(c.greenChannel); add(c.blueChannel); add(c.whiteChannel);
    } else if (c.colorType === 'ColorWheel') {
        add(c.wheelDimmerChannel);
    }
    // CMY: intensity is the dimmer only; the colour channels stay pass-through.
    add(def.dimmer.channel);
    return dimmable;
}

/**
 * Complement of the dimmable set within a fixture's channel range: the 0-based
 * channel offsets that must pass through unscaled (motors, shutter, wheel slot,
 * presets, and any channel not positively known to be intensity).
 */
export function mhNoDimChannels(def: MhDefinition, channelCount: number): number[] {
    const dimmable = mhDimmableChannels(def);
    const offsets: number[] = [];
    for (let o = 0; o < channelCount; o++) {
        if (!dimmable.has(o + 1)) offsets.push(o);
    }
    return offsets;
}

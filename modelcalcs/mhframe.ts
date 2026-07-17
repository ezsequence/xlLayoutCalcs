// Moving Head Frame-level Processing
// Slices model channels from frame data and runs forward/reverse engines.

import { MhDefinition } from "./mhdef";
import { MhPhysicalState, mhChannelsToState } from "./mhcalc";

/**
 * Extract model channel data from a frame buffer and compute physical state.
 *
 * @param def - Moving head definition
 * @param frameData - Full frame buffer (all channels for entire sequence)
 * @param channelOffset - 0-based offset of this model's first channel in the frame
 * @returns Physical state of the moving head for this frame
 */
export function processMhFrame(
    def: MhDefinition,
    frameData: ArrayBuffer,
    channelOffset: number,
): MhPhysicalState {
    const fullFrame = new Uint8Array(frameData);
    const modelChannels = fullFrame.slice(channelOffset, channelOffset + def.numChannels);
    return mhChannelsToState(def, modelChannels);
}

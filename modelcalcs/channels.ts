/**
 * Channel resolution for xLights models
 *
 * Converts StartChannel strings (which can be in various formats) into
 * absolute 0-based channel numbers (matching xLights model export format).
 */

import type { BaseModelClass, ModelChannelInfo } from "./modelshared";
import type { ChannelRun, ModelChannelMapping } from "./modelbase";
import { getElementsByTagRecursive, getChildElementsByTag } from "./utils";

// Re-export the types for convenience
export type { ChannelRun, ModelChannelMapping } from "./modelbase";
export type { ModelChannelInfo } from "./modelshared";

// ============================================================================
// Output/Controller structures (from xlights_networks.xml)
// ============================================================================

export interface Output {
    universe: number;          // Universe number (1-based as in XML)
    startChannel: number;      // Absolute start channel (0-based)
    channelCount: number;      // Number of channels in this output
    ip?: string;               // IP address if applicable
    type: string;              // E131, ArtNet, DMX, etc.
}

export interface Controller {
    id: string;
    name: string;
    startChannel: number;      // Absolute start channel (0-based)
    channelCount: number;      // Total channels across all outputs
    outputs: Output[];
    ip?: string;
}

export interface OutputManager {
    controllers: Controller[];
    controllersByName: Map<string, Controller>;

    // Universe lookup: key is "universe" or "ip:universe"
    outputsByUniverse: Map<string, Output>;

    totalChannels: number;
}

// ============================================================================
// Parsing xlights_networks.xml
// ============================================================================

export function parseNetworksXml(xmlDoc: Document): OutputManager {
    const controllers: Controller[] = [];
    const controllersByName = new Map<string, Controller>();
    const outputsByUniverse = new Map<string, Output>();

    let currentChannel = 0;  // 0-based

    // Find all Controller elements (recursive search from document root)
    const controllerElements = getElementsByTagRecursive(xmlDoc, 'Controller');

    for (const ctrlElem of controllerElements) {
        const id = ctrlElem.getAttribute('Id') || '';
        const name = ctrlElem.getAttribute('Name') || '';
        const ip = ctrlElem.getAttribute('IP') || undefined;
        // On Serial controllers BaudRate is the actual baud rate, not a
        // universe number — keep their outputs out of the universe map.
        const isSerial = ctrlElem.getAttribute('Type') === 'Serial';

        const controllerStartChannel = currentChannel;
        const outputs: Output[] = [];

        // Parse network (output) elements within this controller
        const networkElements = getChildElementsByTag(ctrlElem, 'network');

        for (const netElem of networkElements) {
            // 510 matches parseControllers' default (E1.31 universe size);
            // real files always write MaxChannels so this is defensive only.
            const maxChannels = parseInt(netElem.getAttribute('MaxChannels') || '510', 10);
            // Real xLights stores the universe number in the BaudRate attribute
            // (upstream IPOutput.cpp: append_attribute("BaudRate") = _universe).
            // A separate Universe attribute wins when present (synthetic files).
            const universe = isSerial ? 0 : parseInt(
                netElem.getAttribute('Universe') || netElem.getAttribute('BaudRate') || '1', 10);
            const universeCount = parseInt(netElem.getAttribute('UniverseCount') || '1', 10);
            const networkType = netElem.getAttribute('NetworkType') || 'E131';
            const outputIp = ip;  // Inherit from controller

            // Create an output for each universe in the range
            for (let u = 0; u < universeCount; u++) {
                const output: Output = {
                    universe: universe + u,
                    startChannel: currentChannel,
                    channelCount: maxChannels,
                    ip: outputIp,
                    type: networkType,
                };

                outputs.push(output);

                // Register in universe lookup (never for serial outputs)
                if (!isSerial) {
                    const universeKey = `${universe + u}`;
                    outputsByUniverse.set(universeKey, output);

                    if (outputIp) {
                        const ipUniverseKey = `${outputIp}:${universe + u}`;
                        outputsByUniverse.set(ipUniverseKey, output);
                    }
                }

                currentChannel += maxChannels;
            }
        }

        const controller: Controller = {
            id,
            name,
            startChannel: controllerStartChannel,
            channelCount: currentChannel - controllerStartChannel,
            outputs,
            ip,
        };

        controllers.push(controller);
        if (name) {
            controllersByName.set(name, controller);
        }
    }

    return {
        controllers,
        controllersByName,
        outputsByUniverse,
        totalChannels: currentChannel,
    };
}

// ============================================================================
// Start Channel String Resolution
// ============================================================================

export interface ResolvedModel {
    name: string;
    firstChannel: number;   // 0-based
    lastChannel: number;    // 0-based
    resolved: boolean;
}

/**
 * Resolve a StartChannel string to an absolute 0-based channel number.
 *
 * Formats supported:
 *   "961"                    - Direct channel number (1-based in XML, converted to 0-based)
 *   "!ControllerName:100"    - Controller-relative (100th channel on controller)
 *   "#1:100"                 - Universe 1, channel 100
 *   "#192.168.1.100:2:100"   - IP-specific universe:channel
 *   ">ModelName:10"          - 10 channels after end of ModelName
 *   "@ModelName:5"           - 5 channels from start of ModelName
 *
 * @returns 0-based channel number, or null if dependency not yet resolved
 */
export function resolveStartChannelString(
    startChannelStr: string,
    outputManager: OutputManager,
    resolvedModels: Map<string, ResolvedModel>,
    logger?: (msg: string) => void,
): number | null {
    const warn = logger ?? ((msg: string) => console.warn(msg));
    const str = startChannelStr.trim();

    if (str === '' || str === '0') {
        return 0;  // Default to channel 0
    }

    const firstChar = str[0];

    // Controller-relative: !ControllerName:channel
    if (firstChar === '!') {
        const rest = str.substring(1);
        const colonIdx = rest.lastIndexOf(':');
        if (colonIdx === -1) {
            warn(`Invalid controller-relative channel string: ${str}`);
            return 0;
        }

        const controllerName = rest.substring(0, colonIdx);
        const channelOffset = parseInt(rest.substring(colonIdx + 1), 10);

        const controller = outputManager.controllersByName.get(controllerName);
        if (!controller) {
            warn(`Controller not found: ${controllerName}`);
            return 0;
        }

        // controller.startChannel is 0-based, channelOffset is 1-based
        return controller.startChannel + channelOffset - 1;
    }

    // Universe-based: #universe:channel or #ip:universe:channel
    if (firstChar === '#') {
        const rest = str.substring(1);
        const parts = rest.split(':');

        let universe: number;
        let channelOffset: number;
        let lookupKey: string;

        if (parts.length === 2) {
            // #universe:channel
            universe = parseInt(parts[0], 10);
            channelOffset = parseInt(parts[1], 10);
            lookupKey = `${universe}`;
        } else if (parts.length === 3) {
            // #ip:universe:channel
            const ip = parts[0];
            universe = parseInt(parts[1], 10);
            channelOffset = parseInt(parts[2], 10);
            lookupKey = `${ip}:${universe}`;
        } else {
            warn(`Invalid universe channel string: ${str}`);
            return 0;
        }

        const output = outputManager.outputsByUniverse.get(lookupKey);
        if (!output) {
            // Try without IP
            const output2 = outputManager.outputsByUniverse.get(`${universe}`);
            if (!output2) {
                warn(`Universe not found: ${lookupKey}`);
                return 0;
            }
            // output2.startChannel is 0-based, channelOffset is 1-based offset within universe
            return output2.startChannel + channelOffset - 1;
        }

        // output.startChannel is 0-based, channelOffset is 1-based offset within universe
        return output.startChannel + channelOffset - 1;
    }

    // After model: >ModelName:offset
    if (firstChar === '>') {
        const rest = str.substring(1);
        const colonIdx = rest.lastIndexOf(':');

        let modelName: string;
        let offset: number;

        if (colonIdx === -1) {
            modelName = rest;
            offset = 1;
        } else {
            modelName = rest.substring(0, colonIdx);
            offset = parseInt(rest.substring(colonIdx + 1), 10);
        }

        const refModel = resolvedModels.get(modelName);
        if (!refModel || !refModel.resolved) {
            // Dependency not yet resolved
            return null;
        }

        // Return channel after the referenced model's last channel
        return refModel.lastChannel + offset;
    }

    // From model start: @ModelName:offset
    if (firstChar === '@') {
        const rest = str.substring(1);
        const colonIdx = rest.lastIndexOf(':');

        let modelName: string;
        let offset: number;

        if (colonIdx === -1) {
            modelName = rest;
            offset = 1;
        } else {
            modelName = rest.substring(0, colonIdx);
            offset = parseInt(rest.substring(colonIdx + 1), 10);
        }

        const refModel = resolvedModels.get(modelName);
        if (!refModel || !refModel.resolved) {
            // Dependency not yet resolved
            return null;
        }

        // refModel.firstChannel is 0-based, offset is 1-based (matches xLights
        // convention: "@Foo:1" means the first channel of Foo).
        return refModel.firstChannel + offset - 1;
    }

    // Direct number (1-based in XML, convert to 0-based)
    const directChannel = parseInt(str, 10);
    if (!isNaN(directChannel)) {
        return directChannel - 1;
    }

    warn(`Unrecognized start channel format: ${str}`);
    return 0;
}

// ============================================================================
// StringType to Channels-Per-Node mapping
// ============================================================================

/**
 * Determine channels per node from StringType attribute.
 *
 * Common values:
 *   "RGB Nodes" -> 3
 *   "RGBW Nodes" -> 4
 *   "RGBWW Nodes" -> 4 (WW = Warm White)
 *   "RBG Nodes" -> 3 (different color order, same channel count)
 *   "Single Color Red" -> 1
 *   "Single Color Green" -> 1
 *   "Single Color Blue" -> 1
 *   "Single Color White" -> 1
 *   "Single Color Custom" -> 1
 *   "Superstring" -> 1 channel per colour (e.g., 2 for red+green Bunnings lights)
 *   "Node Single Color" -> 1
 *   "Strobes" -> 1
 *   "3 Channel RGB" -> 3
 *   "4 Channel RGBW" -> 4
 *   "4 Channel WRGB" -> 4
 *
 * @param stringType The StringType attribute value
 * @param superStringColourCount For Superstring types, the number of colours (default 1)
 */
export function getChannelsPerNode(stringType: string, superStringColourCount: number = 0): number {
    const st = stringType.toLowerCase();

    // Superstring: one channel per colour
    if (st === 'superstring') {
        return superStringColourCount > 0 ? superStringColourCount : 1;
    }

    // Check for explicit channel count first (e.g., "3 Channel RGB", "4 Channel RGBW")
    const match = st.match(/(\d+)\s*channel/);
    if (match) {
        return parseInt(match[1], 10);
    }

    // It is really not clear if this is correct.
    if (st.includes('rgbww')) return 5;

    // RGBW variants (4 channels) - includes RGBWW (WW = Warm White)
    // Must check before RGB
    if (st.includes('rgbw') || st.includes('rbgw') ||
        st.includes('bgrw') || st.includes('brgw') ||
        st.includes('grbw') || st.includes('gbrw') ||
        st.includes('wrgb') || st.includes('wrbg') ||
        st.includes('wbgr') || st.includes('wbrg') ||
        st.includes('wgrb') || st.includes('wgbr'))
    {
        return 4;
    }

    // RGB variants (3 channels)
    if (st.includes('rgb') || st.includes('rbg') || st.includes('grb') ||
        st.includes('bgr') || st.includes('brg') || st.includes('gbr')) {
        return 3;
    }

    // Single color / dumb strings / strobes
    if (st.includes('single color') || st.includes('node single color') ||
        st.includes('strobes')) {
        return 1;
    }

    // Default to RGB
    return 3;
}

// ============================================================================
// StringType to ChannelRole[] mapping
// ============================================================================

import type { ChannelRole, ChannelRoleKind } from "./modelbase";

/** Implicit tints for the named-color kinds (must agree with ChannelRoleKind docs). */
const NAMED_TINTS: Record<string, string> = {
    red:        '#ff0000',
    green:      '#00ff00',
    blue:       '#0000ff',
    white:      '#ffffff',
    warmWhite:  '#ffe5cc',
};

const SINGLE_COLOR_TINTS: Record<string, string> = {
    red:    '#ff0000',
    green:  '#00ff00',
    blue:   '#0000ff',
    white:  '#ffffff',
    yellow: '#ffff00',
    cyan:   '#00ffff',
    magenta: '#ff00ff',
    pink:   '#ffc0cb',
    orange: '#ffa500',
    purple: '#800080',
};

/** Letter → role kind, for color-order strings like "RGB", "BGR", "WRGB", "RGBWW". */
function letterToKind(letter: string, secondW: boolean): ChannelRoleKind {
    switch (letter) {
        case 'r': case 'R': return 'red';
        case 'g': case 'G': return 'green';
        case 'b': case 'B': return 'blue';
        case 'w': case 'W': return secondW ? 'warmWhite' : 'white';
        default:            return 'unused';
    }
}

/**
 * Compute the per-channel role table for a single node.
 *
 * Length matches getChannelsPerNode(stringType, superStringColours.size).
 * The result is what a preview consumer needs in order to turn raw frame
 * bytes (at offsets 0..channelsPerNode-1 of each node) into RGB.
 *
 * - "RGB Nodes" / color-order variants → red/green/blue (and white/warmWhite for RGBW/RGBWW)
 * - "Single Color <Name>" → one 'intensity' channel tinted with the named color
 * - "Single Color Custom" / "Single Color Intensity" → one 'intensity' channel tinted with customColor (defaults to white when blank)
 * - "Superstring" → one 'tint' channel per superStringColours entry
 * - "Strobes" / "Node Single Color" → one 'intensity' channel tinted white
 * - "N Channel <ORDER>" (e.g. "4 Channel RGBW") → letters mapped in order
 */
export function computeChannelRoles(
    stringType: string,
    customColor: string,
    superStringColours: Map<number, string>,
): ChannelRole[] {
    if (!stringType) return [];
    const st = stringType.trim();
    const lower = st.toLowerCase();

    // Superstring: one 'tint' per per-string color
    if (lower === 'superstring') {
        const count = superStringColours.size || 1;
        const out: ChannelRole[] = [];
        for (let i = 0; i < count; i++) {
            const tint = superStringColours.get(i) || '#ffffff';
            out.push({ offset: i, kind: 'tint', tint });
        }
        return out;
    }

    // Single color: one 'intensity' channel tinted by the suffix
    if (lower.startsWith('single color')) {
        const suffix = lower.substring('single color'.length).trim();
        let tint: string;
        if (suffix === 'custom' || suffix === 'intensity' || suffix === '') {
            tint = (customColor && customColor !== '#000000') ? customColor : '#ffffff';
        } else {
            tint = SINGLE_COLOR_TINTS[suffix] || '#ffffff';
        }
        return [{ offset: 0, kind: 'intensity', tint }];
    }

    // Strobes / Node Single Color: 1-channel intensity, white
    if (lower === 'strobes' || lower.includes('node single color')) {
        return [{ offset: 0, kind: 'intensity', tint: '#ffffff' }];
    }

    // "N Channel <ORDER>" (e.g. "3 Channel RGB", "4 Channel RGBW", "4 Channel WRGB")
    const channelMatch = lower.match(/^(\d+)\s*channel\s+([rgbw]+)$/);
    if (channelMatch) {
        return lettersToRoles(channelMatch[2]);
    }

    // "<ORDER> Nodes" (e.g. "RGB Nodes", "RBG Nodes", "RGBW Nodes", "RGBWW Nodes")
    const nodesMatch = lower.match(/^([rgbw]+)\s+nodes?$/);
    if (nodesMatch) {
        return lettersToRoles(nodesMatch[1]);
    }

    // Bare letter sequence, e.g. "RGB"
    const bare = lower.match(/^([rgbw]+)$/);
    if (bare) {
        return lettersToRoles(bare[1]);
    }

    // Fallback: assume RGB
    return lettersToRoles('rgb');
}

function lettersToRoles(letters: string): ChannelRole[] {
    const out: ChannelRole[] = [];
    let sawW = false;
    for (let i = 0; i < letters.length; i++) {
        const ch = letters[i].toLowerCase();
        const isWarmW = (ch === 'w' && sawW);
        if (ch === 'w') sawW = true;
        const kind = letterToKind(ch, isWarmW);
        const role: ChannelRole = { offset: i, kind };
        if (kind in NAMED_TINTS && (kind === 'intensity' || kind === 'tint')) {
            role.tint = NAMED_TINTS[kind];
        }
        out.push(role);
    }
    return out;
}

// ============================================================================
// Building Channel Mapping for a Model
// ============================================================================

export interface ModelChannelInput {
    name: string;
    startChannel: string;              // Raw StartChannel attribute
    stringType: string;                // StringType attribute
    numStrings: number;                // Number of strings
    nodesPerString: number[];          // Nodes per string (array for variable)
    advanced: boolean;                 // Whether using per-string start channels
    stringStartChannels: Map<number, string>;  // Per-string start channels if advanced
    superStringColourCount: number;    // Number of colours for Superstring type
    // Per-string start NODE numbers (Custom models; see ModelChannelInfo).
    stringStartNodes?: Map<number, number>;
}

/**
 * Build channel mapping for a single model.
 *
 * @returns ModelChannelMapping, or null if dependencies not yet resolved
 */
export function buildModelChannelMapping(
    model: ModelChannelInput,
    outputManager: OutputManager,
    resolvedModels: Map<string, ResolvedModel>,
    logger?: (msg: string) => void,
): ModelChannelMapping | null {
    const channelsPerNode = getChannelsPerNode(model.stringType, model.superStringColourCount);
    const nodeChannelMap: ChannelRun[] = [];

    // Custom-model placement: every string is an offset from the ONE model
    // start channel, so resolve it once up front. (String starts need not be
    // ascending, so this cannot be expressed as sequential chaining.)
    const startNodes = model.numStrings > 1 ? model.stringStartNodes : undefined;
    let baseStartChannel: number | null = null;
    if (startNodes) {
        baseStartChannel = resolveStartChannelString(model.startChannel, outputManager, resolvedModels, logger);
        if (baseStartChannel === null) {
            // Dependency not yet resolved
            return null;
        }
    }

    let nodeIndex = 0;
    let minChannel = Infinity;
    let maxChannel = -1;
    let totalChannels = 0;

    for (let s = 0; s < model.numStrings; s++) {
        const nodesInString = model.nodesPerString[s] ?? model.nodesPerString[0] ?? 1;

        // Determine start channel for this string
        let startChannel: number | null;

        if (startNodes && baseStartChannel !== null && startNodes.has(s)) {
            startChannel = baseStartChannel + (startNodes.get(s)! - 1) * channelsPerNode;
        } else if (model.advanced && model.stringStartChannels.has(s)) {
            // Advanced mode: each string has its own start channel
            startChannel = resolveStartChannelString(
                model.stringStartChannels.get(s)!,
                outputManager,
                resolvedModels,
                logger
            );
        } else if (s === 0) {
            // First string uses model's start channel
            startChannel = resolveStartChannelString(model.startChannel, outputManager, resolvedModels, logger);
        } else {
            // Non-advanced mode: strings are sequential
            // Next string starts right after previous string ends
            const prevRun = nodeChannelMap[nodeChannelMap.length - 1];
            startChannel = prevRun.channelStart + (prevRun.nodeCount * prevRun.channelsPerNode);
        }

        if (startChannel === null) {
            // Dependency not yet resolved
            return null;
        }

        const run: ChannelRun = {
            // With explicit start nodes the run covers node values
            // [startNode, startNode + count), so index by value rather than
            // by accumulation — string order need not follow node order.
            nodeStart: startNodes?.has(s) ? startNodes.get(s)! - 1 : nodeIndex,
            nodeCount: nodesInString,
            channelStart: startChannel,
            channelsPerNode,
            stringIndex: s,
        };

        nodeChannelMap.push(run);

        // Track bounds (all 1-based)
        minChannel = Math.min(minChannel, startChannel);
        const runLastChannel = startChannel + (nodesInString * channelsPerNode) - 1;
        maxChannel = Math.max(maxChannel, runLastChannel);
        totalChannels += nodesInString * channelsPerNode;

        nodeIndex += nodesInString;
    }

    // Handle edge case of no strings
    if (nodeChannelMap.length === 0) {
        minChannel = 0;
        maxChannel = -1;
    }

    return {
        nodeChannelMap,
        totalNodes: nodeIndex,
        totalChannels,
        channelsPerNode,
        numStrings: model.numStrings,
        firstChannel: minChannel === Infinity ? 0 : minChannel,
        lastChannel: maxChannel,
    };
}

// ============================================================================
// Multi-pass resolution for all models
// ============================================================================

export interface ModelForResolution {
    name: string;
    startChannel: string;
    stringType: string;
    numStrings: number;
    nodesPerString: number[];
    advanced: boolean;
    stringStartChannels: Map<number, string>;
    superStringColourCount: number;
    // Per-string start NODE numbers (Custom models; see ModelChannelInfo).
    stringStartNodes?: Map<number, number>;
}

export interface ResolvedModelWithMapping extends ResolvedModel {
    channelMapping: ModelChannelMapping;
}

/**
 * Resolve channel mappings for all models, handling dependencies.
 *
 * Uses iterative resolution:
 * 1. First pass: resolve models with direct/controller/universe channels
 * 2. Subsequent passes: resolve models depending on already-resolved models
 * 3. Continue until all resolved or no progress (circular dependency)
 */
export function resolveAllModelChannels(
    models: ModelForResolution[],
    outputManager: OutputManager,
    logger?: (msg: string) => void,
): Map<string, ResolvedModelWithMapping> {
    const resolved = new Map<string, ResolvedModelWithMapping>();
    const pending = new Map<string, ModelForResolution>();

    // Initialize pending set
    for (const model of models) {
        pending.set(model.name, model);
    }

    let madeProgress = true;
    let iteration = 0;
    const maxIterations = models.length + 1;

    while (pending.size > 0 && madeProgress && iteration < maxIterations) {
        madeProgress = false;
        iteration++;

        const toResolve = Array.from(pending.values());

        for (const model of toResolve) {
            // Build simplified resolved models map for dependency lookup
            const resolvedForLookup = new Map<string, ResolvedModel>();
            for (const [name, rm] of resolved) {
                resolvedForLookup.set(name, rm);
            }

            const input: ModelChannelInput = {
                name: model.name,
                startChannel: model.startChannel,
                stringType: model.stringType,
                numStrings: model.numStrings,
                nodesPerString: model.nodesPerString,
                advanced: model.advanced,
                stringStartChannels: model.stringStartChannels,
                superStringColourCount: model.superStringColourCount,
                stringStartNodes: model.stringStartNodes,
            };

            const mapping = buildModelChannelMapping(input, outputManager, resolvedForLookup, logger);

            if (mapping !== null) {
                resolved.set(model.name, {
                    name: model.name,
                    firstChannel: mapping.firstChannel,
                    lastChannel: mapping.lastChannel,
                    resolved: true,
                    channelMapping: mapping,
                });
                pending.delete(model.name);
                madeProgress = true;
            }
        }
    }

    // Warn about unresolved models (likely circular dependencies)
    if (pending.size > 0) {
        const warn = logger ?? ((msg: string) => console.warn(msg));
        warn(`Could not resolve channels for ${pending.size} models (possible circular dependencies):`);
        for (const name of pending.keys()) {
            warn(`  - ${name}`);
        }
    }

    return resolved;
}

// ============================================================================
// Utility functions
// ============================================================================

/**
 * Get the first channel for a specific node in a model.
 *
 * @param mapping The model's channel mapping
 * @param nodeIndex 0-based node index
 * @returns 0-based channel number, or -1 if node not found
 */
export function nodeToChannel(mapping: ModelChannelMapping, nodeIndex: number): number {
    for (const run of mapping.nodeChannelMap) {
        if (nodeIndex >= run.nodeStart && nodeIndex < run.nodeStart + run.nodeCount) {
            const offset = nodeIndex - run.nodeStart;
            return run.channelStart + (offset * run.channelsPerNode);
        }
    }
    return -1;
}

/**
 * Get all channels used by a specific node (for RGB/RGBW).
 *
 * @param mapping The model's channel mapping
 * @param nodeIndex 0-based node index
 * @returns Array of 0-based channel numbers [R, G, B] or [R, G, B, W], or empty if not found
 */
export function nodeToChannels(mapping: ModelChannelMapping, nodeIndex: number): number[] {
    for (const run of mapping.nodeChannelMap) {
        if (nodeIndex >= run.nodeStart && nodeIndex < run.nodeStart + run.nodeCount) {
            const offset = nodeIndex - run.nodeStart;
            const baseChannel = run.channelStart + (offset * run.channelsPerNode);

            const channels: number[] = [];
            for (let i = 0; i < run.channelsPerNode; i++) {
                channels.push(baseChannel + i);
            }
            return channels;
        }
    }
    return [];
}

/**
 * Find which node uses a given channel.
 *
 * @param mapping The model's channel mapping
 * @param channel 0-based channel number
 * @returns Object with nodeIndex and channelOffset within node, or null if not found
 */
export function channelToNode(
    mapping: ModelChannelMapping,
    channel: number
): { nodeIndex: number; channelOffset: number; stringIndex: number } | null {
    for (const run of mapping.nodeChannelMap) {
        const runEnd = run.channelStart + (run.nodeCount * run.channelsPerNode);

        if (channel >= run.channelStart && channel < runEnd) {
            const relativeChannel = channel - run.channelStart;
            const nodeOffset = Math.floor(relativeChannel / run.channelsPerNode);
            const channelOffset = relativeChannel % run.channelsPerNode;

            return {
                nodeIndex: run.nodeStart + nodeOffset,
                channelOffset,
                stringIndex: run.stringIndex,
            };
        }
    }
    return null;
}

// ============================================================================
// Integration with BaseModelClass
// ============================================================================

/**
 * Extract channel-relevant info from a parsed model.
 * Delegates to the model's getChannelInfo() method.
 */
export function extractModelChannelInfo(model: BaseModelClass): ModelForResolution {
    return model.getChannelInfo();
}

/**
 * Resolve channels for an array of parsed BaseModelClass objects.
 *
 * @param models Array of models created via createModelFromXml
 * @param outputManager Parsed from xlights_networks.xml
 * @returns Map of model name to resolved channel mapping
 */
export function resolveModelChannels(
    models: BaseModelClass[],
    outputManager: OutputManager,
): Map<string, ResolvedModelWithMapping> {
    const modelInfos = models.map(m => extractModelChannelInfo(m));
    return resolveAllModelChannels(modelInfos, outputManager);
}

// ============================================================================
// Complete workflow helper
// ============================================================================

export interface ChannelResolutionResult {
    outputManager: OutputManager;
    modelChannels: Map<string, ResolvedModelWithMapping>;
}

/**
 * Complete channel resolution workflow.
 *
 * @param networksXmlDoc Parsed xlights_networks.xml document
 * @param models Array of models created via createModelFromXml
 * @returns OutputManager and resolved channel mappings for all models
 *
 * @example
 * ```typescript
 * // Parse the XML files
 * const parser = new DOMParser();
 * const networksDoc = parser.parseFromString(networksXmlString, 'text/xml');
 * const rgbeffectsDoc = parser.parseFromString(rgbeffectsXmlString, 'text/xml');
 *
 * // Create models from rgbeffects
 * const modelElements = rgbeffectsDoc.querySelectorAll('model');
 * const models = Array.from(modelElements).map(el => createModelFromXml(el));
 *
 * // Resolve channels
 * const result = resolveChannels(networksDoc, models);
 *
 * // Get channel info for a specific model
 * const archChannels = result.modelChannels.get('MyArch');
 * if (archChannels) {
 *     console.log(`First channel: ${archChannels.firstChannel}`);
 *     console.log(`Last channel: ${archChannels.lastChannel}`);
 *
 *     // Get channel for node 5
 *     const chan = nodeToChannel(archChannels.channelMapping, 5);
 * }
 * ```
 */
export function resolveChannels(
    networksXmlDoc: Document,
    models: BaseModelClass[],
): ChannelResolutionResult {
    const outputManager = parseNetworksXml(networksXmlDoc);
    const modelChannels = resolveModelChannels(models, outputManager);

    return {
        outputManager,
        modelChannels,
    };
}

// ============================================================================
// Enriching GetNodeResult with channel info
// ============================================================================

import type { GetNodeResult } from "./modelbase";

/**
 * Populate channel on each node and add channelMapping to the result.
 *
 * @param nodeResult The result from getNodeCoords()
 * @param channelMapping The resolved channel mapping for this model
 * @returns The same nodeResult with channel info populated
 */
export function enrichWithChannels(
    nodeResult: GetNodeResult,
    channelMapping: ModelChannelMapping,
): GetNodeResult {
    // Populate channel (0-based) on each node
    // Use physicalNum (wiring order) rather than array index (visual order)
    for (const node of nodeResult.nodes) {
        const chan = nodeToChannel(channelMapping, node.physicalNum);
        node.channel = chan >= 0 ? chan : undefined;
    }

    // Attach the mapping to the result
    nodeResult.channelMapping = channelMapping;

    return nodeResult;
}

/**
 * Get coordinates with channel info for a model.
 *
 * This is a convenience function that combines getNodeCoords() with
 * channel resolution in one call.
 *
 * @param model The model
 * @param outputManager The output manager (from parseNetworksXml)
 * @param resolvedModels Map of already-resolved models (for dependencies)
 * @returns GetNodeResult with channel info, or null if channels couldn't be resolved
 */
export function getNodeCoordsWithChannels(
    model: BaseModelClass,
    outputManager: OutputManager,
    resolvedModels: Map<string, ResolvedModel>,
): GetNodeResult | null {
    // Get geometry
    const nodeResult = model.getNodeCoords();

    // Extract channel info and build mapping
    const modelInfo = extractModelChannelInfo(model);

    const channelMapping = buildModelChannelMapping(modelInfo, outputManager, resolvedModels);

    if (channelMapping === null) {
        // Dependencies not yet resolved
        return null;
    }

    return enrichWithChannels(nodeResult, channelMapping);
}

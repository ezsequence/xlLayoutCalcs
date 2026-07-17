export class XMLConstants
{
    static ELEMENT_NODE = 1;
    static ATTRIBUTE_NODE = 2;
    static TEXT_NODE = 3;
    static CDATA_SECTION_NODE = 4;
    static ENTITY_REFERENCE_NODE = 5;
    static ENTITY_NODE = 6;
    static PROCESSING_INSTRUCTION_NODE = 7;
    static COMMENT_NODE = 8;
    static DOCUMENT_NODE = 9;
    static DOCUMENT_TYPE_NODE = 10;
    static DOCUMENT_FRAGMENT_NODE = 11;
    static NOTATION_NODE = 12;
}

export function getElementByTag(e: Element, t: string): Element {
    for (let ie = 0; ie < e.childNodes.length; ++ie) {
        const n = e.childNodes[ie];
        if (n.nodeType === XMLConstants.ELEMENT_NODE) {
            const ce = n as Element;
            if (ce.tagName === t) return ce;
        }
    }
    throw new Error(`Element does not contain child with tag ${t}`);
}

export function getOptionalElementByTag(e: Element, t: string): Element | undefined {
    for (let ie = 0; ie < e.childNodes.length; ++ie) {
        const n = e.childNodes[ie];
        if (n.nodeType === XMLConstants.ELEMENT_NODE) {
            const ce = n as Element;
            if (ce.tagName === t) return ce;
        }
    }
    return undefined;
}

export function getNumAttrDef(n: Node | null | undefined, nm: string, def: number) : number
{
    if (!n) return def;
    const el = n as Element;
    const v = el.getAttribute(nm);
    if (!v) return def;
    return Number.parseFloat(v);
}

export function getBoolAttrDef(n: Node | null | undefined, nm: string, def: boolean) : boolean
{
    if (!n) return def;
    const el = n as Element;
    const v = el.getAttribute(nm);
    if (!v) return def;
    return v[0] === 'T' || v[0] ==='t' || v[0] === '1';
}

export function getIntAttrDef(n: Node | null | undefined, nm: string, def: number) : number
{
    if (!n) return def;
    const el = n as Element;
    const v = el.getAttribute(nm);
    if (!v) return def;
    return Number.parseInt(v);
}

export function getAttrDef(n: Node | null | undefined, nm: string, def: string) : string
{
    if (!n) return def;
    const el = n as Element;
    const v = el.getAttribute(nm);
    if (!v) return def;
    return v;
}

export function getText(n: Node) : string | null
{
    return n.textContent;
}

export function getTextDef(n: Node, def: string) : string
{
    return n.textContent || def;
}

export function setText(n: Node, txt: string)
{
    n.textContent = txt;
}

/**
 * Find all child elements with a specific tag name (non-recursive).
 */
export function getChildElementsByTag(parent: Element | Document, tagName: string): Element[] {
    const results: Element[] = [];
    const children = parent.childNodes;
    for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (node.nodeType === XMLConstants.ELEMENT_NODE) {
            const el = node as Element;
            if (el.tagName === tagName) {
                results.push(el);
            }
        }
    }
    return results;
}

/**
 * Find all descendant elements with a specific tag name (recursive).
 */
export function getElementsByTagRecursive(parent: Element | Document, tagName: string): Element[] {
    const results: Element[] = [];

    function recurse(node: Element | Document) {
        const children = node.childNodes;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.nodeType === XMLConstants.ELEMENT_NODE) {
                const el = child as Element;
                if (el.tagName === tagName) {
                    results.push(el);
                }
                recurse(el);
            }
        }
    }

    recurse(parent);
    return results;
}

/**
 * Get the document element from a Document or return the Element if already an Element.
 */
export function getDocumentElement(doc: Document | Element): Element {
    if ('documentElement' in doc && doc.documentElement) {
        return doc.documentElement;
    }
    return doc as Element;
}

export function toRadians(deg:number) {
    return deg / 180 * Math.PI;
}
export function rotatePoint(cx: number, cy: number, angle: number, x: number, y: number) {
    const s = Math.sin(angle);
    const c = Math.cos(angle);

    return {
        x: (x - cx) * c - (y - cy) * s + cx,
        y: (x - cx) * s + (y - cy) * c + cy,
    };
}

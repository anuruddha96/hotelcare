/**
 * Minimal, dependency-free XML reader for NAV Online Számla responses.
 *
 * NAV responses are machine-generated, namespace-qualified XML without DTDs.
 * This parser intentionally supports only what those documents need
 * (elements, attributes, text, CDATA, comments, processing instructions) and
 * REJECTS any DOCTYPE/DTD so entity-expansion attacks are impossible.
 * Element lookups use local names (namespace prefixes are stripped) because
 * NAV may choose arbitrary prefixes (ns2:, common:, …) for the same element.
 */

export interface XmlNode {
  /** Qualified name as written, e.g. "ns2:invoiceDigest". */
  name: string;
  /** Local name without prefix, e.g. "invoiceDigest". */
  local: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated direct text content (not trimmed). */
  text: string;
}

export class XmlParseError extends Error {}

const MAX_XML_BYTES = 25 * 1024 * 1024;

function localName(qualified: string): string {
  const i = qualified.indexOf(":");
  return i >= 0 ? qualified.slice(i + 1) : qualified;
}

export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_m, entity: string) => {
    switch (entity) {
      case "lt": return "<";
      case "gt": return ">";
      case "amp": return "&";
      case "quot": return "\"";
      case "apos": return "'";
      default: {
        const code = entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) throw new XmlParseError("Invalid character reference");
        return String.fromCodePoint(code);
      }
    }
  });
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXml(xml: string): XmlNode {
  if (typeof xml !== "string" || !xml.trim()) throw new XmlParseError("Empty XML document");
  if (xml.length > MAX_XML_BYTES) throw new XmlParseError("XML document too large");
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new XmlParseError("DTD/ENTITY declarations are not allowed");
  }

  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let i = 0;
  const n = xml.length;

  const appendText = (text: string) => {
    if (!text) return;
    const top = stack[stack.length - 1];
    if (top) top.text += text;
    else if (text.trim()) throw new XmlParseError("Text outside of the root element");
  };

  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      appendText(decodeXmlEntities(xml.slice(i)));
      break;
    }
    if (lt > i) appendText(decodeXmlEntities(xml.slice(i, lt)));

    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      if (end < 0) throw new XmlParseError("Unterminated processing instruction");
      i = end + 2;
      continue;
    }
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end < 0) throw new XmlParseError("Unterminated comment");
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end < 0) throw new XmlParseError("Unterminated CDATA section");
      appendText(xml.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (xml.startsWith("</", lt)) {
      const end = xml.indexOf(">", lt + 2);
      if (end < 0) throw new XmlParseError("Unterminated end tag");
      const name = xml.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw new XmlParseError(`Mismatched end tag </${name}>`);
      if (stack.length === 0) root = top;
      i = end + 1;
      continue;
    }

    // Start tag (attribute values may contain '>' only when quoted).
    let j = lt + 1;
    let quote: string | null = null;
    while (j < n) {
      const ch = xml[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === "\"" || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      j++;
    }
    if (j >= n) throw new XmlParseError("Unterminated start tag");
    let body = xml.slice(lt + 1, j);
    const selfClosing = body.endsWith("/");
    if (selfClosing) body = body.slice(0, -1);
    const nameMatch = body.match(/^([^\s/>]+)/);
    if (!nameMatch) throw new XmlParseError("Invalid start tag");
    const name = nameMatch[1];
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    const attrSource = body.slice(name.length);
    let m: RegExpExecArray | null;
    while ((m = ATTR_RE.exec(attrSource)) !== null) {
      attrs[m[1]] = decodeXmlEntities(m[2] ?? m[3] ?? "");
    }
    const node: XmlNode = { name, local: localName(name), attrs, children: [], text: "" };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else if (root || stack.length) throw new XmlParseError("Multiple root elements");
    if (selfClosing) {
      if (!parent) root = node;
    } else {
      stack.push(node);
    }
    i = j + 1;
  }

  if (stack.length) throw new XmlParseError(`Unclosed element <${stack[stack.length - 1].name}>`);
  if (!root) throw new XmlParseError("No root element");
  return root;
}

/** First direct child with the given local name. */
export function child(node: XmlNode | null | undefined, local: string): XmlNode | undefined {
  return node?.children.find((c) => c.local === local);
}

/** All direct children with the given local name. */
export function children(node: XmlNode | null | undefined, local: string): XmlNode[] {
  return node ? node.children.filter((c) => c.local === local) : [];
}

/** Depth-first search for the first descendant with the given local name. */
export function descendant(node: XmlNode | null | undefined, local: string): XmlNode | undefined {
  if (!node) return undefined;
  for (const c of node.children) {
    if (c.local === local) return c;
    const found = descendant(c, local);
    if (found) return found;
  }
  return undefined;
}

/** Follow a path of local names; returns trimmed text or null. */
export function textAt(node: XmlNode | null | undefined, ...path: string[]): string | null {
  let current: XmlNode | undefined = node ?? undefined;
  for (const segment of path) {
    current = child(current, segment);
    if (!current) return null;
  }
  const value = current?.text.trim();
  return value ? value : null;
}

export function numberAt(node: XmlNode | null | undefined, ...path: string[]): number | null {
  const raw = textAt(node, ...path);
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function booleanAt(node: XmlNode | null | undefined, ...path: string[]): boolean | null {
  const raw = textAt(node, ...path);
  if (raw == null) return null;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return null;
}

/** Escape text for inclusion in element content or attribute values. */
export function escapeXml(value: string | number | boolean): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

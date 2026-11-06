/**
 * A small streaming XML reader for the parts of an .xlsx: enough XML to read
 * what Excel and other writers produce, with no DOM, so it runs in a worker
 * and in Node tests alike. Element and attribute names lose their namespace
 * prefix ("x:c" and "c" are both "c"); namespaces themselves are not checked.
 */

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlError';
  }
}

export interface XmlHandler {
  open?: (name: string, attributes: Record<string, string>) => void;
  close?: (name: string) => void;
  text?: (text: string) => void;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/** Line breaks as an XML parser reports them: CRLF and lone CR become LF. */
const textOf = (raw: string) => decodeEntities(raw.includes('\r') ? raw.replace(/\r\n?/g, '\n') : raw);
/** Attribute values as an XML parser reports them: tabs and line breaks become spaces. */
const attributeOf = (raw: string) => decodeEntities(/[\t\n\r]/.test(raw) ? raw.replace(/\r\n|[\t\n\r]/g, ' ') : raw);

const localName = (name: string) => {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
};

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function find(xml: string, what: string, from: number): number {
  const at = xml.indexOf(what, from);
  if (at === -1) throw new XmlError('The XML ends in the middle of a tag.');
  return at;
}

/** Calls the handler for each element start, end and run of text, in document order. */
export function scanXml(xml: string, handler: XmlHandler): void {
  const { open, close, text } = handler;
  const n = xml.length;
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      if (text) text(textOf(xml.slice(i)));
      break;
    }
    if (lt > i && text) text(textOf(xml.slice(i, lt)));
    const next = xml.charCodeAt(lt + 1);
    if (next === 47 /* / */) {
      const gt = find(xml, '>', lt);
      if (close) close(localName(xml.slice(lt + 2, gt).trim()));
      i = gt + 1;
    } else if (next === 63 /* ? */) {
      i = find(xml, '?>', lt) + 2;
    } else if (next === 33 /* ! */) {
      if (xml.startsWith('<!--', lt)) {
        i = find(xml, '-->', lt) + 3;
      } else if (xml.startsWith('<![CDATA[', lt)) {
        const end = find(xml, ']]>', lt);
        if (text) text(xml.slice(lt + 9, end).replace(/\r\n?/g, '\n'));
        i = end + 3;
      } else {
        i = find(xml, '>', lt) + 1;
      }
    } else {
      // The tag ends at the first '>' outside a quoted attribute value.
      let j = lt + 1;
      let quote = 0;
      for (; j < n; j++) {
        const c = xml.charCodeAt(j);
        if (quote) {
          if (c === quote) quote = 0;
        } else if (c === 34 || c === 39) {
          quote = c;
        } else if (c === 62 /* > */) {
          break;
        }
      }
      if (j >= n) throw new XmlError('The XML ends in the middle of a tag.');
      const selfClosing = xml.charCodeAt(j - 1) === 47;
      const body = xml.slice(lt + 1, selfClosing ? j - 1 : j);
      let nameEnd = 0;
      while (nameEnd < body.length && !/\s/.test(body[nameEnd])) nameEnd++;
      const name = localName(body.slice(0, nameEnd));
      const attributes: Record<string, string> = {};
      if (nameEnd < body.length) {
        ATTRIBUTE.lastIndex = nameEnd;
        let match: RegExpExecArray | null;
        while ((match = ATTRIBUTE.exec(body))) {
          attributes[localName(match[1])] = attributeOf(match[2] ?? match[3]);
        }
      }
      if (open) open(name, attributes);
      if (selfClosing && close) close(name);
      i = j + 1;
    }
  }
}

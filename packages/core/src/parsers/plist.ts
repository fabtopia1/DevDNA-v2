/**
 * Minimal, dependency-free XML property list reader.
 *
 * Every libimobiledevice tool DevDNA shells out to can emit XML plist
 * (`ideviceinfo -x`, `idevicediagnostics ioregistry`), so a single parser
 * covers the whole collection surface. Binary plists are not produced by those
 * tools and are deliberately out of scope.
 *
 * `<data>` is surfaced as its base64 text rather than a Buffer so snapshots
 * stay JSON-serialisable end to end — snapshots are persisted verbatim.
 */

export type PlistValue =
  | string
  | number
  | boolean
  | null
  | PlistValue[]
  | { [key: string]: PlistValue };

export class PlistParseError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} (at offset ${offset})`);
    this.name = 'PlistParseError';
  }
}

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  /** Index just past the `>` of this tag. */
  end: number;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return ENTITIES[entity] ?? match;
  });
}

class Reader {
  pos = 0;
  constructor(readonly src: string) {}

  /** Advance past whitespace, comments, XML declarations and the doctype. */
  skipTrivia(): void {
    for (;;) {
      while (this.pos < this.src.length && /\s/.test(this.src[this.pos] as string)) this.pos += 1;
      if (this.src.startsWith('<!--', this.pos)) {
        const end = this.src.indexOf('-->', this.pos);
        this.pos = end === -1 ? this.src.length : end + 3;
        continue;
      }
      if (this.src.startsWith('<?', this.pos) || this.src.startsWith('<!', this.pos)) {
        const end = this.src.indexOf('>', this.pos);
        this.pos = end === -1 ? this.src.length : end + 1;
        continue;
      }
      return;
    }
  }

  peekTag(): Tag | null {
    const save = this.pos;
    const tag = this.readTag(true);
    this.pos = save;
    return tag;
  }

  readTag(tolerant = false): Tag | null {
    this.skipTrivia();
    if (this.src[this.pos] !== '<') {
      if (tolerant) return null;
      throw new PlistParseError('expected a tag', this.pos);
    }
    const end = this.src.indexOf('>', this.pos);
    if (end === -1) {
      if (tolerant) return null;
      throw new PlistParseError('unterminated tag', this.pos);
    }
    const body = this.src.slice(this.pos + 1, end).trim();
    const closing = body.startsWith('/');
    const selfClosing = body.endsWith('/');
    const name = body.replace(/^\//, '').replace(/\/$/, '').split(/\s/)[0] ?? '';
    this.pos = end + 1;
    return { name, closing, selfClosing, end: end + 1 };
  }

  /** Text content up to the matching closing tag, entity-decoded. */
  readTextUntilClose(tagName: string): string {
    const close = `</${tagName}>`;
    const end = this.src.indexOf(close, this.pos);
    if (end === -1) throw new PlistParseError(`missing ${close}`, this.pos);
    const text = this.src.slice(this.pos, end);
    this.pos = end + close.length;
    return decodeEntities(text);
  }
}

function parseValue(reader: Reader): PlistValue {
  const tag = reader.readTag();
  if (!tag) throw new PlistParseError('unexpected end of document', reader.pos);
  if (tag.closing) throw new PlistParseError(`unexpected </${tag.name}>`, reader.pos);

  switch (tag.name) {
    case 'dict': {
      const dict: Record<string, PlistValue> = {};
      if (tag.selfClosing) return dict;
      for (;;) {
        const next = reader.peekTag();
        if (!next) throw new PlistParseError('unterminated <dict>', reader.pos);
        if (next.closing && next.name === 'dict') {
          reader.readTag();
          return dict;
        }
        const keyTag = reader.readTag();
        if (!keyTag || keyTag.name !== 'key') {
          throw new PlistParseError('expected <key> inside <dict>', reader.pos);
        }
        const key = keyTag.selfClosing ? '' : reader.readTextUntilClose('key');
        dict[key] = parseValue(reader);
      }
    }
    case 'array': {
      const items: PlistValue[] = [];
      if (tag.selfClosing) return items;
      for (;;) {
        const next = reader.peekTag();
        if (!next) throw new PlistParseError('unterminated <array>', reader.pos);
        if (next.closing && next.name === 'array') {
          reader.readTag();
          return items;
        }
        items.push(parseValue(reader));
      }
    }
    case 'string':
      return tag.selfClosing ? '' : reader.readTextUntilClose('string');
    case 'key':
      // A stray <key> outside a dict: treat as a plain string so one malformed
      // section cannot fail an otherwise usable capture.
      return tag.selfClosing ? '' : reader.readTextUntilClose('key');
    case 'integer': {
      if (tag.selfClosing) return 0;
      const raw = reader.readTextUntilClose('integer').trim();
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case 'real': {
      if (tag.selfClosing) return 0;
      const raw = reader.readTextUntilClose('real').trim();
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case 'true':
      if (!tag.selfClosing) reader.readTag();
      return true;
    case 'false':
      if (!tag.selfClosing) reader.readTag();
      return false;
    case 'data':
      return tag.selfClosing ? '' : reader.readTextUntilClose('data').replace(/\s+/g, '');
    case 'date':
      return tag.selfClosing ? '' : reader.readTextUntilClose('date').trim();
    default:
      // Unknown element: consume its body and yield null so the surrounding
      // structure survives.
      if (tag.selfClosing) return null;
      reader.readTextUntilClose(tag.name);
      return null;
  }
}

/** Parse an XML plist document. Returns null for empty input. */
export function parsePlist(xml: string): PlistValue {
  if (!xml || !xml.trim()) return null;
  const reader = new Reader(xml);
  reader.skipTrivia();
  const first = reader.peekTag();
  if (first && first.name === 'plist') {
    reader.readTag();
  }
  return parseValue(reader);
}

/** Parse an XML plist that is expected to be a dictionary at the top level. */
export function parsePlistDict(xml: string): Record<string, PlistValue> {
  const value = parsePlist(xml);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, PlistValue>;
  }
  return {};
}

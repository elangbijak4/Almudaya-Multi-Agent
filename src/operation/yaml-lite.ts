/**
 * Zero-dependency YAML 1.2 / JSON parser & emitter for Agentic Operation manifests.
 * Supports JSON fast-path, comments, block scalars (>, |, >-, |-), nested mappings,
 * sequences (including mapping items starting with `- key: value`), and inline collections.
 */

function stripCommentsPreserveQuotes(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "'" && !inDouble) {
      if (inSingle && line[i + 1] === "'") {
        i++;
        continue;
      }
      inSingle = !inSingle;
    } else if (ch === '"' && !inDouble && !inSingle) {
      inDouble = true;
    } else if (ch === '"' && inDouble) {
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) {
        backslashes++;
      }
      if (backslashes % 2 === 0) {
        inDouble = false;
      }
    } else if (ch === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1]!)) {
        return line.slice(0, i);
      }
    }
  }
  return line;
}

function getIndent(rawLine: string, lineNumber: number): number {
  let count = 0;
  while (count < rawLine.length) {
    const ch = rawLine[count]!;
    if (ch === ' ') {
      count++;
    } else if (ch === '\t') {
      throw new Error(`YAML parse error on line ${lineNumber}: tab indentation is not supported.`);
    } else {
      break;
    }
  }
  return count;
}

function splitKeyValue(trimmed: string): { key: string; rawValue: string } | null {
  if (!trimmed || trimmed.startsWith('-')) {
    return null;
  }

  let keyEnd = -1;
  let keyText = '';
  const first = trimmed[0]!;

  if (first === '"' || first === "'") {
    let closed = -1;
    for (let i = 1; i < trimmed.length; i++) {
      if (first === "'" && trimmed[i] === "'") {
        if (trimmed[i + 1] === "'") {
          i++;
          continue;
        }
        closed = i;
        break;
      }
      if (first === '"' && trimmed[i] === '"') {
        let bs = 0;
        for (let j = i - 1; j >= 0 && trimmed[j] === '\\'; j--) bs++;
        if (bs % 2 === 0) {
          closed = i;
          break;
        }
      }
    }
    if (closed === -1) return null;
    keyText = parseScalar(trimmed.slice(0, closed + 1)) as string;
    const afterQuote = trimmed.slice(closed + 1).trimStart();
    if (!afterQuote.startsWith(':')) return null;
    const colonOffset = trimmed.indexOf(':', closed + 1);
    const rest = trimmed.slice(colonOffset + 1);
    if (rest.length > 0 && !/^\s/.test(rest)) return null;
    keyEnd = colonOffset;
  } else {
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === ':' && (i + 1 === trimmed.length || /\s/.test(trimmed[i + 1]!))) {
        keyEnd = i;
        keyText = trimmed.slice(0, i).trim();
        break;
      }
    }
  }

  if (keyEnd === -1 || !keyText) {
    return null;
  }
  const rawValue = trimmed.slice(keyEnd + 1).trim();
  return { key: String(keyText), rawValue };
}

function splitTopLevelCommas(inner: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (ch === '"' && !inSingle) {
      let bs = 0;
      for (let j = i - 1; j >= 0 && inner[j] === '\\'; j--) bs++;
      if (bs % 2 === 0) inDouble = !inDouble;
      current += ch;
    } else if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') depth--;
      else if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) {
    parts.push(current.trim());
  }
  return parts;
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevelCommas(inner).map((item) => parseScalar(item));
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return {};
    const out: Record<string, unknown> = {};
    for (const part of splitTopLevelCommas(inner)) {
      const kv = splitKeyValue(part);
      if (!kv) {
        throw new Error(`Invalid inline YAML mapping entry: "${part}"`);
      }
      out[kv.key] = parseScalar(kv.rawValue);
    }
    return out;
  }

  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
  }

  return trimmed;
}

class YamlParser {
  private readonly lines: string[];

  constructor(text: string) {
    this.lines = text.replace(/\r\n/g, '\n').split('\n');
  }

  private nextNonEmpty(startIdx: number): number {
    let idx = startIdx;
    while (idx < this.lines.length) {
      const cleaned = stripCommentsPreserveQuotes(this.lines[idx]!).trim();
      if (cleaned !== '' && cleaned !== '---' && cleaned !== '...') {
        return idx;
      }
      idx++;
    }
    return -1;
  }

  private parseBlockScalar(
    startIdx: number,
    parentIndent: number,
    indicator: string
  ): { value: string; nextIdx: number } {
    const folded = indicator.startsWith('>');
    const chomp = indicator.endsWith('-') ? 'strip' : indicator.endsWith('+') ? 'keep' : 'clip';
    const collected: string[] = [];
    let scalarIndent: number | null = null;
    let idx = startIdx;

    while (idx < this.lines.length) {
      const rawLine = this.lines[idx]!;
      if (rawLine.trim() === '') {
        collected.push('');
        idx++;
        continue;
      }
      const ind = getIndent(rawLine, idx + 1);
      if (ind <= parentIndent) {
        break;
      }
      if (scalarIndent === null) {
        scalarIndent = ind;
      }
      collected.push(rawLine.slice(Math.min(ind, scalarIndent)));
      idx++;
    }

    while (collected.length > 0 && collected[collected.length - 1] === '' && chomp !== 'keep') {
      collected.pop();
    }

    let text: string;
    if (folded) {
      const paragraphs: string[] = [];
      let buf: string[] = [];
      for (const l of collected) {
        if (l.trim() === '') {
          if (buf.length > 0) {
            paragraphs.push(buf.join(' '));
            buf = [];
          } else {
            paragraphs.push('');
          }
        } else {
          buf.push(l.trimEnd());
        }
      }
      if (buf.length > 0) {
        paragraphs.push(buf.join(' '));
      }
      text = paragraphs.join('\n');
    } else {
      text = collected.join('\n');
    }

    if (chomp === 'clip' && text.length > 0) {
      text += '\n';
    }
    return { value: text, nextIdx: idx };
  }

  public parseRoot(): unknown {
    const first = this.nextNonEmpty(0);
    if (first === -1) return {};
    const ind = getIndent(this.lines[first]!, first + 1);
    return this.parseBlock(first, ind).value;
  }

  private parseBlock(startIdx: number, minIndent: number): { value: unknown; nextIdx: number } {
    const idx = this.nextNonEmpty(startIdx);
    if (idx === -1) return { value: null, nextIdx: this.lines.length };

    const ind = getIndent(this.lines[idx]!, idx + 1);
    if (ind < minIndent) {
      return { value: null, nextIdx: idx };
    }

    const trimmed = stripCommentsPreserveQuotes(this.lines[idx]!.slice(ind)).trim();
    if (trimmed === '-' || trimmed.startsWith('- ')) {
      return this.parseSequence(idx, ind);
    }
    if (splitKeyValue(trimmed)) {
      return this.parseMapping(idx, ind);
    }
    return { value: parseScalar(trimmed), nextIdx: idx + 1 };
  }

  private parseKeyValueEntry(
    key: string,
    rawValue: string,
    lineIdx: number,
    keyIndent: number
  ): { key: string; value: unknown; nextIdx: number } {
    if (rawValue === '>' || rawValue === '|') {
      const res = this.parseBlockScalar(lineIdx + 1, keyIndent, rawValue);
      return { key, value: res.value, nextIdx: res.nextIdx };
    }
    if (rawValue === '>-' || rawValue === '|-' || rawValue === '>+' || rawValue === '|+') {
      const res = this.parseBlockScalar(lineIdx + 1, keyIndent, rawValue);
      return { key, value: res.value, nextIdx: res.nextIdx };
    }
    if (rawValue === '') {
      const next = this.nextNonEmpty(lineIdx + 1);
      if (next === -1) {
        return { key, value: null, nextIdx: this.lines.length };
      }
      const nextInd = getIndent(this.lines[next]!, next + 1);
      const nextTrimmed = stripCommentsPreserveQuotes(this.lines[next]!.slice(nextInd)).trim();
      if (nextInd > keyIndent) {
        const nested = this.parseBlock(next, nextInd);
        return { key, value: nested.value, nextIdx: nested.nextIdx };
      }
      if (nextInd === keyIndent && (nextTrimmed === '-' || nextTrimmed.startsWith('- '))) {
        const nested = this.parseSequence(next, nextInd);
        return { key, value: nested.value, nextIdx: nested.nextIdx };
      }
      return { key, value: null, nextIdx: next };
    }
    return { key, value: parseScalar(rawValue), nextIdx: lineIdx + 1 };
  }

  private parseMapping(
    startIdx: number,
    mapIndent: number,
    initial: Record<string, unknown> = {}
  ): { value: Record<string, unknown>; nextIdx: number } {
    const obj: Record<string, unknown> = { ...initial };
    let idx = startIdx;

    while (true) {
      const next = this.nextNonEmpty(idx);
      if (next === -1) {
        idx = this.lines.length;
        break;
      }
      const ind = getIndent(this.lines[next]!, next + 1);
      if (ind < mapIndent) {
        idx = next;
        break;
      }
      if (ind > mapIndent) {
        throw new Error(`Unexpected indentation on line ${next + 1} inside mapping.`);
      }
      const trimmed = stripCommentsPreserveQuotes(this.lines[next]!.slice(ind)).trim();
      if (trimmed === '-' || trimmed.startsWith('- ')) {
        idx = next;
        break;
      }
      const kv = splitKeyValue(trimmed);
      if (!kv) {
        throw new Error(`Expected "key: value" on line ${next + 1}, got "${trimmed}".`);
      }
      const entry = this.parseKeyValueEntry(kv.key, kv.rawValue, next, mapIndent);
      obj[entry.key] = entry.value;
      idx = entry.nextIdx;
    }

    return { value: obj, nextIdx: idx };
  }

  private parseSequence(
    startIdx: number,
    seqIndent: number
  ): { value: unknown[]; nextIdx: number } {
    const items: unknown[] = [];
    let idx = startIdx;

    while (true) {
      const next = this.nextNonEmpty(idx);
      if (next === -1) {
        idx = this.lines.length;
        break;
      }
      const ind = getIndent(this.lines[next]!, next + 1);
      if (ind < seqIndent) {
        idx = next;
        break;
      }
      if (ind > seqIndent) {
        throw new Error(`Unexpected indentation on line ${next + 1} inside sequence.`);
      }

      const rawSlice = stripCommentsPreserveQuotes(this.lines[next]!.slice(ind));
      const trimmed = rawSlice.trim();
      if (trimmed !== '-' && !trimmed.startsWith('- ')) {
        idx = next;
        break;
      }

      const afterDashRaw = rawSlice.slice(1);
      const leadingSpaces = afterDashRaw.length - afterDashRaw.trimStart().length;
      const itemContentIndent = ind + 1 + (leadingSpaces || 1);
      const afterDash = afterDashRaw.trim();

      if (afterDash === '') {
        const nested = this.parseBlock(next + 1, ind + 1);
        items.push(nested.value);
        idx = nested.nextIdx;
        continue;
      }

      if (afterDash === '>' || afterDash === '|' || afterDash === '>-' || afterDash === '|-') {
        const scalar = this.parseBlockScalar(next + 1, ind, afterDash);
        items.push(scalar.value);
        idx = scalar.nextIdx;
        continue;
      }

      const kv = splitKeyValue(afterDash);
      if (kv) {
        const firstEntry = this.parseKeyValueEntry(kv.key, kv.rawValue, next, itemContentIndent);
        const mapped = this.parseMapping(firstEntry.nextIdx, itemContentIndent, {
          [firstEntry.key]: firstEntry.value,
        });
        items.push(mapped.value);
        idx = mapped.nextIdx;
        continue;
      }

      items.push(parseScalar(afterDash));
      idx = next + 1;
    }

    return { value: items, nextIdx: idx };
  }
}

export function parseOperationDocument(rawText: string): unknown {
  const normalized = rawText.replace(/\r\n/g, '\n');
  const nonCommentLines = normalized
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

  if (nonCommentLines.length === 0) {
    return {};
  }

  const firstTrimmed = nonCommentLines[0]!.trim();
  if (firstTrimmed.startsWith('{') || firstTrimmed.startsWith('[')) {
    return JSON.parse(nonCommentLines.join('\n'));
  }

  const parser = new YamlParser(normalized);
  return parser.parseRoot();
}

function formatScalar(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean' || typeof val === 'number') return String(val);
  const str = String(val);
  if (
    str === '' ||
    str === 'true' ||
    str === 'false' ||
    str === 'null' ||
    str === '~' ||
    /^-?\d+(?:\.\d+)?$/.test(str) ||
    /[\r\n:#\[\]{}&*!|>'",%@`]/.test(str) ||
    str.startsWith(' ') ||
    str.endsWith(' ')
  ) {
    return JSON.stringify(str);
  }
  return str;
}

function serializeYamlValue(val: unknown, indent: number): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    const lines: string[] = [];
    for (const item of val) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
        if (entries.length === 0) {
          lines.push(`${pad}- {}`);
        } else {
          const [firstKey, firstVal] = entries[0]!;
          if (firstVal !== null && typeof firstVal === 'object') {
            if (Array.isArray(firstVal) && firstVal.length === 0) {
              lines.push(`${pad}- ${firstKey}: []`);
            } else if (!Array.isArray(firstVal) && Object.keys(firstVal).length === 0) {
              lines.push(`${pad}- ${firstKey}: {}`);
            } else {
              lines.push(`${pad}- ${firstKey}:`);
              lines.push(serializeYamlValue(firstVal, indent + 4));
            }
          } else {
            lines.push(`${pad}- ${firstKey}: ${formatScalar(firstVal)}`);
          }
          for (const [k, v] of entries.slice(1)) {
            if (v !== null && typeof v === 'object') {
              if (Array.isArray(v) && v.length === 0) {
                lines.push(`${pad}  ${k}: []`);
              } else if (!Array.isArray(v) && Object.keys(v).length === 0) {
                lines.push(`${pad}  ${k}: {}`);
              } else {
                lines.push(`${pad}  ${k}:`);
                lines.push(serializeYamlValue(v, indent + 4));
              }
            } else {
              lines.push(`${pad}  ${k}: ${formatScalar(v)}`);
            }
          }
        }
      } else if (Array.isArray(item)) {
        if (item.length === 0) {
          lines.push(`${pad}- []`);
        } else {
          lines.push(`${pad}-`);
          lines.push(serializeYamlValue(item, indent + 2));
        }
      } else {
        lines.push(`${pad}- ${formatScalar(item)}`);
      }
    }
    return lines.join('\n');
  }

  if (val !== null && typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    const lines: string[] = [];
    for (const [k, v] of entries) {
      if (v !== null && typeof v === 'object') {
        if (Array.isArray(v) && v.length === 0) {
          lines.push(`${pad}${k}: []`);
        } else if (!Array.isArray(v) && Object.keys(v).length === 0) {
          lines.push(`${pad}${k}: {}`);
        } else {
          lines.push(`${pad}${k}:`);
          lines.push(serializeYamlValue(v, indent + 2));
        }
      } else {
        lines.push(`${pad}${k}: ${formatScalar(v)}`);
      }
    }
    return lines.join('\n');
  }

  return `${pad}${formatScalar(val)}`;
}

export function stringifyOperationYaml(value: unknown): string {
  return `${serializeYamlValue(value, 0)}\n`;
}

// Small dependency-free spreadsheet reader for uploads: .xlsx (Office Open XML) and .csv.
// Returns every sheet as rows of raw cell values (strings, numbers or booleans). Excel dates stay as serial numbers;
// the caller decides how a column is read. Sizes are capped so a crafted file cannot exhaust memory.
import { inflateRawSync } from 'node:zlib';
import { AppError } from './service.mjs';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 60 * 1024 * 1024, MAX_ROWS = 5000, MAX_COLUMNS = 80;

export function readSpreadsheet(fileName, buffer) {
  if (buffer.length > MAX_UPLOAD_BYTES) throw new AppError('The file is larger than 5 MB. Split it or remove unused sheets.', 413);
  if (buffer.subarray(0, 4).toString('latin1') === 'PK\x03\x04') return readXlsx(buffer);
  if (buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) throw new AppError('This is an older .xls file. In Excel choose File → Save As → Excel Workbook (.xlsx), then upload that.');
  if (/\.(csv|txt)$/i.test(fileName)) return [{ name: fileName.replace(/\.[^.]+$/, ''), rows: readCsv(buffer.toString('utf8').replace(/^﻿/, '')) }];
  throw new AppError('Upload an Excel workbook (.xlsx) or a CSV file.');
}

// ---------- ZIP container ----------
function unzip(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new AppError('The workbook could not be read. Open it in Excel and save it again as .xlsx.');
  const count = buffer.readUInt16LE(end + 10), files = new Map();
  let offset = buffer.readUInt32LE(end + 16), unpacked = 0;
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new AppError('The workbook is damaged.');
    const method = buffer.readUInt16LE(offset + 10), compressed = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32), local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extra + comment;
    if (!/^(xl\/(workbook\.xml|sharedStrings\.xml|worksheets\/[^/]+\.xml|_rels\/workbook\.xml\.rels))$/.test(name)) continue;
    unpacked += size;
    if (unpacked > MAX_UNPACKED_BYTES) throw new AppError('The workbook is too large to import.', 413);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28), data = buffer.subarray(start, start + compressed);
    if (method === 0) files.set(name, data.toString('utf8'));
    else if (method === 8) files.set(name, inflateRawSync(data, { maxOutputLength: Math.max(size, 1) + 1024 }).toString('utf8'));
    else throw new AppError('The workbook uses an unsupported compression method. Save it again in Excel.');
  }
  return files;
}

// ---------- Workbook XML ----------
const decode = text => text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))));
const textOf = xml => decode([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''));
const columnIndex = ref => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

function readXlsx(buffer) {
  const files = unzip(buffer), workbook = files.get('xl/workbook.xml');
  if (!workbook) throw new AppError('This file is not an Excel workbook.');
  const shared = [...(files.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]));
  const rels = Object.fromEntries([...(files.get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)].map(m => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map(m => ({ name: decode(/name="([^"]*)"/.exec(m[0])?.[1] || 'Sheet'), target: rels[/r:id="([^"]+)"/.exec(m[0])?.[1]] }));
  return sheets.map(({ name, target }) => {
    const xml = files.get(`xl/${String(target || '').replace(/^\/?xl\//, '')}`) || '';
    const rows = [];
    for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= MAX_ROWS) throw new AppError(`Sheet "${name}" has more than ${MAX_ROWS} rows. Split the file and upload it in parts.`, 413);
      const index = Number(/r="(\d+)"/.exec(row[1])?.[1] || rows.length + 1) - 1, cells = [];
      for (const cell of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1], body = cell[2] || '', ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const col = ref ? columnIndex(ref) : cells.length, type = /t="([^"]+)"/.exec(attrs)?.[1], v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (col >= MAX_COLUMNS) continue;
        let value = '';
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'b') value = v === '1';
        else if (type === 'str' || type === 'e') value = decode(v ?? '');
        else if (v !== undefined && v !== '') value = Number(v);
        cells[col] = value;
      }
      while (rows.length < index) rows.push([]);
      rows[index] = Array.from(cells, c => c ?? '');
    }
    return { name, rows };
  });
}

// ---------- CSV ----------
export function readCsv(text) {
  const delimiter = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c; continue; }
    if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; if (rows.length > MAX_ROWS) throw new AppError(`The file has more than ${MAX_ROWS} rows. Split it and upload it in parts.`, 413); }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.map(r => r.slice(0, MAX_COLUMNS));
}

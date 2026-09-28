// Reading the one file inside a zip archive (pure, no dependencies): enough for GDELT's daily
// files, which each hold a single CSV. Reads the central directory at the end of the archive,
// then that entry's data, stored or deflated.

import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;     // end of central directory
const CENTRAL = 0x02014b50;  // central directory file header
const LOCAL = 0x04034b50;    // local file header

/** The first entry of a zip archive: { name, data: Buffer }. Throws if it isn't a zip. */
export function unzipFirst(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Not a zip archive (too short)');
  // The end record is the last 22 bytes, unless the archive has a comment (up to 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip archive (no end record)');
  if (buf.readUInt16LE(eocd + 10) < 1) throw new Error('Empty zip archive');
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== CENTRAL) throw new Error('Damaged zip archive (central directory)');
  const method = buf.readUInt16LE(cd + 10);
  const size = buf.readUInt32LE(cd + 20);
  const nameLength = buf.readUInt16LE(cd + 28);
  const name = buf.toString('utf8', cd + 46, cd + 46 + nameLength);
  const local = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(local) !== LOCAL) throw new Error('Damaged zip archive (local header)');
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const raw = buf.subarray(start, start + size);
  if (method === 0) return { name, data: Buffer.from(raw) };
  if (method === 8) return { name, data: inflateRawSync(raw) };
  throw new Error(`Unsupported zip compression method ${method}`);
}

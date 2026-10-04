/**
 * Minimal ZIP writer (no compression, no dependencies).
 *
 * The portal offers “Download package” so the operator can hand-upload the HLS folder or archive it.
 * HLS segments are already-compressed video, so storing them uncompressed costs nothing in size and
 * keeps this to ~100 lines instead of pulling in a zip library.
 *
 * Supports the classic (non-Zip64) format: individual files and the whole archive must stay below 4 GB.
 */
import fs from 'node:fs';
import { once } from 'node:events';

// Standard CRC-32 (polynomial 0xEDB88320), computed with a lookup table.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();
export function crc32(buf, seed = 0) {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS time/date pair used by the ZIP headers. */
function dosStamp(date = new Date()) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, date: day };
}

/**
 * Writes a ZIP containing `entries` ([{ path, name }] — `name` is the path inside the archive).
 * Returns `{ bytes, files }`.
 */
export async function writeZip(destPath, entries, { date = new Date() } = {}) {
  const { time, date: dosDate } = dosStamp(date);
  // The file is opened once: the same handle writes through a stream and patches each local header's
  // CRC once that file's data has been written (the header has to be written before the data, and the
  // CRC is only known after it).
  const patchFd = await fs.promises.open(destPath, 'w+');
  const out = fs.createWriteStream(null, { fd: patchFd.fd, autoClose: false, highWaterMark: 1 << 20 });
  const write = async (buf) => { if (!out.write(buf)) await once(out, 'drain'); };
  const central = [];
  let offset = 0, total = 0;

  for (const entry of entries) {
    const cleanName = String(entry.name).replace(/\\/g, '/').split('/').filter((part) => part && part !== '.' && part !== '..').join('/');
    const name = Buffer.from(cleanName || 'file', 'utf8');
    const { size } = fs.statSync(entry.path);
    if (size > 0xffffffff) throw new Error(`“${entry.name}” is larger than 4 GB — the built-in ZIP writer cannot store it.`);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);      // local file header
    header.writeUInt16LE(20, 4);              // version needed
    header.writeUInt16LE(0x0800, 6);          // UTF-8 names
    header.writeUInt16LE(0, 8);               // stored (no compression)
    header.writeUInt16LE(time, 10); header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(0, 14);              // crc — patched below
    header.writeUInt32LE(size >>> 0, 18); header.writeUInt32LE(0, 22);
    header.writeUInt16LE(name.length, 26); header.writeUInt16LE(0, 28);
    await write(header); await write(name);
    const dataOffset = offset + 30 + name.length;
    let crc = 0, written = 0;
    const stream = fs.createReadStream(entry.path, { highWaterMark: 1 << 20 });
    for await (const chunk of stream) { crc = crc32(chunk, crc); written += chunk.length; await write(chunk); }
    // Backfill the CRC now that the whole file has been read.
    const patch = Buffer.alloc(4); patch.writeUInt32LE(crc >>> 0, 0);
    await patchFd.write(patch, 0, 4, offset + 14);
    central.push({ name, crc, size: written, offset });
    offset = dataOffset + written; total += 30 + name.length + written;
  }

  // Central directory + end-of-central-directory record.
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6);
    h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(0, 10);
    h.writeUInt16LE(time, 12); h.writeUInt16LE(dosDate, 14);
    h.writeUInt32LE(c.crc >>> 0, 16);
    h.writeUInt32LE(c.size >>> 0, 20); h.writeUInt32LE(c.size >>> 0, 24);
    h.writeUInt16LE(c.name.length, 28);
    h.writeUInt32LE(c.offset >>> 0, 42);
    await write(h); await write(c.name);
  }
  const centralSize = central.reduce((n, c) => n + 46 + c.name.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(centralSize >>> 0, 12); eocd.writeUInt32LE(total >>> 0, 16);
  await write(eocd);
  out.end();
  await once(out, 'finish');
  await patchFd.close();
  return { bytes: total + centralSize + 22, files: entries.length };
}

export interface ZipEntry {
  name: string;
  content: Buffer;
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Int32Array {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

/** Standard CRC-32 (IEEE 802.3) — what ZIP's per-entry checksum requires. */
export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

/**
 * Minimal ZIP writer: uncompressed ("stored") entries only. An .xlsx is just
 * a ZIP of a handful of small XML parts, so this avoids pulling in a
 * general-purpose zip/deflate library for what's a fully-specified, static
 * binary format — no compression needed for files this small.
 */
export function createZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.content);
    const size = entry.content.length;

    const localHeader = Buffer.concat([
      u32(0x04034b50), // local file header signature
      u16(20), // version needed to extract (2.0)
      u16(0), // general purpose bit flag
      u16(0), // compression method: 0 = stored
      u16(0), // last mod file time
      u16(0), // last mod file date
      u32(crc),
      u32(size), // compressed size == uncompressed (stored)
      u32(size), // uncompressed size
      u16(nameBuf.length),
      u16(0), // extra field length
    ]);
    localParts.push(localHeader, nameBuf, entry.content);

    const centralHeader = Buffer.concat([
      u32(0x02014b50), // central directory file header signature
      u16(20), // version made by
      u16(20), // version needed to extract
      u16(0), // general purpose bit flag
      u16(0), // compression method
      u16(0), // last mod file time
      u16(0), // last mod file date
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBuf.length),
      u16(0), // extra field length
      u16(0), // file comment length
      u16(0), // disk number start
      u16(0), // internal file attributes
      u32(0), // external file attributes
      u32(offset), // relative offset of local header
    ]);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + entry.content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralDirectoryOffset = offset;

  const eocd = Buffer.concat([
    u32(0x06054b50), // end of central directory signature
    u16(0), // number of this disk
    u16(0), // disk where central directory starts
    u16(entries.length), // central directory records on this disk
    u16(entries.length), // total central directory records
    u32(centralDirectory.length),
    u32(centralDirectoryOffset),
    u16(0), // comment length
  ]);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

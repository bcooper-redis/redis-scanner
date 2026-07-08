/**
 * Test-only ZIP reader: scans local file headers directly (not the central
 * directory) to pull out one stored (uncompressed) entry's raw bytes. Valid
 * only for exactly the kind of archive src/export/zip.ts writes — good
 * enough to verify our own writer's output without a zip-reading library.
 */
export function extractStoredEntry(zip: Buffer, name: string): Buffer | null {
  const nameBuf = Buffer.from(name, 'utf8');
  let offset = 0;
  while (offset < zip.length - 4) {
    if (zip.readUInt32LE(offset) === 0x04034b50) {
      const compressedSize = zip.readUInt32LE(offset + 18);
      const nameLength = zip.readUInt16LE(offset + 26);
      const extraLength = zip.readUInt16LE(offset + 28);
      const entryNameStart = offset + 30;
      const entryName = zip.subarray(entryNameStart, entryNameStart + nameLength);
      const contentStart = entryNameStart + nameLength + extraLength;
      if (entryName.equals(nameBuf)) {
        return zip.subarray(contentStart, contentStart + compressedSize);
      }
      offset = contentStart + compressedSize;
    } else {
      offset++;
    }
  }
  return null;
}

export function listStoredEntryNames(zip: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset < zip.length - 4) {
    if (zip.readUInt32LE(offset) === 0x04034b50) {
      const compressedSize = zip.readUInt32LE(offset + 18);
      const nameLength = zip.readUInt16LE(offset + 26);
      const extraLength = zip.readUInt16LE(offset + 28);
      const entryNameStart = offset + 30;
      names.push(zip.subarray(entryNameStart, entryNameStart + nameLength).toString('utf8'));
      offset = entryNameStart + nameLength + extraLength + compressedSize;
    } else {
      offset++;
    }
  }
  return names;
}

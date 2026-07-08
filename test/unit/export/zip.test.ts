import { describe, it, expect } from 'vitest';
import { crc32, createZip } from '../../../src/export/zip';
import { extractStoredEntry, listStoredEntryNames } from './zipTestUtil';

describe('crc32', () => {
  it('matches the standard CRC-32 (IEEE 802.3) test vectors', () => {
    expect(crc32(Buffer.from(''))).toBe(0x00000000);
    expect(crc32(Buffer.from('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('is deterministic and content-sensitive', () => {
    const a = crc32(Buffer.from('hello'));
    const b = crc32(Buffer.from('hello'));
    const c = crc32(Buffer.from('hellp'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('createZip', () => {
  it('starts with the ZIP local file header signature', () => {
    const zip = createZip([{ name: 'a.txt', content: Buffer.from('hi') }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  });

  it('ends with the end-of-central-directory signature', () => {
    const zip = createZip([{ name: 'a.txt', content: Buffer.from('hi') }]);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });

  it('round-trips single-entry content exactly', () => {
    const content = Buffer.from('hello world, this is stored content');
    const zip = createZip([{ name: 'a.txt', content }]);
    expect(extractStoredEntry(zip, 'a.txt')).toEqual(content);
  });

  it('round-trips multiple entries independently, preserving order and content', () => {
    const zip = createZip([
      { name: 'one.txt', content: Buffer.from('first') },
      { name: 'two.txt', content: Buffer.from('second, longer content here') },
      { name: 'dir/three.txt', content: Buffer.from('third') },
    ]);
    expect(listStoredEntryNames(zip)).toEqual(['one.txt', 'two.txt', 'dir/three.txt']);
    expect(extractStoredEntry(zip, 'one.txt')?.toString()).toBe('first');
    expect(extractStoredEntry(zip, 'two.txt')?.toString()).toBe('second, longer content here');
    expect(extractStoredEntry(zip, 'dir/three.txt')?.toString()).toBe('third');
  });

  it('round-trips empty content', () => {
    const zip = createZip([{ name: 'empty.txt', content: Buffer.alloc(0) }]);
    expect(extractStoredEntry(zip, 'empty.txt')).toEqual(Buffer.alloc(0));
  });

  it('round-trips binary content containing every byte value', () => {
    const content = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const zip = createZip([{ name: 'bin.dat', content }]);
    expect(extractStoredEntry(zip, 'bin.dat')).toEqual(content);
  });

  it('handles zero entries', () => {
    const zip = createZip([]);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(listStoredEntryNames(zip)).toEqual([]);
  });
});

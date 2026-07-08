import { describe, it, expect } from 'vitest';
import { buildXlsxWorkbook } from '../../../src/export/xlsx';
import { extractStoredEntry, listStoredEntryNames } from './zipTestUtil';

function sheetXml(xlsx: Buffer): string {
  const entry = extractStoredEntry(xlsx, 'xl/worksheets/sheet1.xml');
  if (!entry) throw new Error('sheet1.xml not found in generated workbook');
  return entry.toString('utf8');
}

describe('buildXlsxWorkbook', () => {
  it('includes every required OOXML part', () => {
    const xlsx = buildXlsxWorkbook('Sheet1', ['A'], [['x']]);
    expect(listStoredEntryNames(xlsx)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it('writes the sheet name into workbook.xml', () => {
    const xlsx = buildXlsxWorkbook('ClusterData', ['A'], []);
    const workbookXml = extractStoredEntry(xlsx, 'xl/workbook.xml')!.toString('utf8');
    expect(workbookXml).toContain('name="ClusterData"');
  });

  it('writes header row as inline-string cells', () => {
    const xml = sheetXml(buildXlsxWorkbook('S', ['Host', 'Port'], []));
    expect(xml).toContain('<row r="1">');
    expect(xml).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Host</t></is></c>');
    expect(xml).toContain('<c r="B1" t="inlineStr"><is><t xml:space="preserve">Port</t></is></c>');
  });

  it('writes string data cells as inline strings and numbers as plain numeric cells', () => {
    const xml = sheetXml(buildXlsxWorkbook('S', ['Name', 'Count'], [['redis', 5]]));
    expect(xml).toContain('<row r="2">');
    expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">redis</t></is></c>');
    expect(xml).toContain('<c r="B2"><v>5</v></c>');
  });

  it('omits null/empty cells entirely rather than writing a fake value', () => {
    const xml = sheetXml(buildXlsxWorkbook('S', ['A', 'B', 'C'], [['x', null, '']]));
    expect(xml).toContain('r="A2"');
    expect(xml).not.toContain('r="B2"');
    expect(xml).not.toContain('r="C2"');
  });

  it('escapes XML-special characters in string values', () => {
    const xml = sheetXml(buildXlsxWorkbook('S', ['A'], [['<script>&"\'']]));
    expect(xml).toContain('&lt;script&gt;&amp;&quot;&apos;');
    expect(xml).not.toContain('<script>');
  });

  it('strips control characters XML forbids outright, without erroring', () => {
    const xml = sheetXml(buildXlsxWorkbook('S', ['A'], [['bad\x00\x01value']]));
    expect(xml).toContain('badvalue');
  });

  it('produces multiple data rows numbered starting at row 2', () => {
    const xml = sheetXml(buildXlsxWorkbook('S', ['A'], [['one'], ['two'], ['three']]));
    expect(xml).toContain('<row r="2">');
    expect(xml).toContain('<row r="3">');
    expect(xml).toContain('<row r="4">');
  });

  it('handles zero data rows, producing just the header', () => {
    const xml = sheetXml(buildXlsxWorkbook('S', ['A', 'B'], []));
    expect(xml).toContain('<row r="1">');
    expect(xml).not.toContain('<row r="2">');
  });

  it('sets the dimension to span every column and row', () => {
    const xml = sheetXml(buildXlsxWorkbook('S', ['A', 'B', 'C'], [['1'], ['2']]));
    expect(xml).toContain('<dimension ref="A1:C3"/>');
  });
});

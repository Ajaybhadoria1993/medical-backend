// Private exam notes leave the server only through ExaminationService.notesFor; reads the service files, no DB.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const MAIN = join(__dirname, '../..');

// Reads that never reach a screen: the PDF renders printable cells only, Copy From Last Visit is Doctor / Admin.
const REVIEWED: Record<string, string> = {
  'reports/services/prescriptionPrint.service.ts':
    'PDF input only; chartPrintSections skips private. and noPrint cells',
};

const serviceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory())
      return f === '__tests__' ? [] : serviceFiles(p);
    return f.endsWith('.service.ts') ? [p] : [];
  });

const readsNotes = (code: string) =>
  /ReportCardModel\.additionalInformation/.test(code) ||
  /\.select\(\)\s*\.from\(ReportCardModel\)/.test(code);

describe('private exam notes', () => {
  it('every service that reads them also filters them through notesFor', () => {
    const unfiltered = serviceFiles(MAIN)
      .map((file) => relative(MAIN, file).replace(/\\/g, '/'))
      .filter((file) => !REVIEWED[file])
      .filter((file) => {
        const code = readFileSync(join(MAIN, file), 'utf8');
        return readsNotes(code) && !/ExaminationService\.notesFor\(/.test(code);
      });
    expect(unfiltered).toEqual([]);
  });
});

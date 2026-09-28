import handlebars from 'handlebars';
import { database } from '../../../configurations/dbConnection';
import { TranslationProviderService } from '../services/translationProvider.service';
import { PrescriptionTranslationService } from '../services/prescriptionTranslation.service';
import {
  PRESCRIPTION_DICTIONARIES,
  toPrescriptionLanguage,
} from '../utils/prescriptionLanguages.utils';
import {
  hashPhrase,
  lookupDictionary,
  needsTranslation,
  numbersMatch,
  toPhraseKey,
} from '../utils/prescriptionTranslation.utils';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn(), insert: jest.fn(), update: jest.fn() },
}));
jest.mock('../../../utils/logger');
jest.mock('../services/translationProvider.service', () => ({
  TranslationProviderService: {
    isEnabled: jest.fn(),
    translateBatch: jest.fn(),
  },
}));

type Call = { method: string; args: unknown[] };

/** Awaitable Drizzle-style chain: every builder call records itself and resolves to `value`. */
const chain = (value: unknown, calls: Call[] = []): object => {
  const proxy: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then')
          return (resolve: (v: unknown) => void) => resolve(value);
        if (prop === 'catch') return () => proxy;
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args });
          return proxy;
        };
      },
    }
  );
  return proxy;
};

/** True when a Drizzle condition tree binds `needle` as a value. */
const bindsValue = (node: unknown, needle: unknown, depth = 0): boolean => {
  if (depth > 10 || node == null) return false;
  if (node === needle) return true;
  if (Array.isArray(node))
    return node.some((item) => bindsValue(item, needle, depth + 1));
  if (typeof node !== 'object') return false;
  return ['value', 'queryChunks', 'left', 'right', 'conditions'].some((key) =>
    bindsValue((node as Record<string, unknown>)[key], needle, depth + 1)
  );
};

const db = database as unknown as Record<
  'select' | 'insert' | 'update',
  jest.Mock
>;
const provider = TranslationProviderService as unknown as Record<
  'isEnabled' | 'translateBatch',
  jest.Mock
>;
const hi = PRESCRIPTION_DICTIONARIES.hi;
const scope = { clinicId: 'clinic-1', doctorId: 'doctor-1' };

/** The row values handed to `insert(...).values(...)`. */
const insertedRows = (calls: Call[]) =>
  calls.find((call) => call.method === 'values')?.args[0] as Array<
    Record<string, unknown>
  >;

beforeEach(() => {
  jest.clearAllMocks();
  db.select.mockReturnValue(chain([]));
  db.update.mockReturnValue(chain(undefined));
  db.insert.mockReturnValue(chain(undefined));
  provider.isEnabled.mockReturnValue(false);
});

describe('phrase helpers', () => {
  it('keys ignore case, spacing and a trailing full stop or colon', () => {
    expect(toPhraseKey('  After   Food. ')).toBe('after food');
    expect(toPhraseKey('Next Visit:')).toBe('next visit');
  });

  it('skips text with no Latin letters', () => {
    expect(needsTranslation('1-0-1')).toBe(false);
    expect(needsTranslation('12-Sep-2026')).toBe(true);
    expect(needsTranslation('5 days')).toBe(true);
  });

  it('builds durations from the unit word', () => {
    expect(lookupDictionary('5 days', hi)).toBe('5 दिन');
    expect(lookupDictionary('after food', hi)).toBe('खाने के बाद');
    expect(lookupDictionary('apply on the rash', hi)).toBeUndefined();
    expect(lookupDictionary('weekly (mon, wed) for 5 weeks', hi)).toBe(
      'साप्ताहिक (सोम, बुध) • 5 सप्ताह'
    );
    expect(lookupDictionary('twice a day • weekly (mon, wed)', hi)).toBe(
      'दिन में दो बार • साप्ताहिक (सोम, बुध)'
    );
    expect(lookupDictionary('weekly (mon, xyz)', hi)).toBeUndefined();
  });

  it('rejects a translation that changed or localised a number', () => {
    expect(
      numbersMatch('Take 2 tablets for 5 days', '5 दिन तक 2 गोली लें')
    ).toBe(true);
    expect(numbersMatch('Take 2 tablets', '3 गोली लें')).toBe(false);
    expect(numbersMatch('Take 2 tablets', '२ गोली लें')).toBe(false);
  });
});

describe('PrescriptionTranslationService.resolve', () => {
  it('answers dictionary phrases without touching the database', async () => {
    const map = await PrescriptionTranslationService.resolve(
      ['After Food', '1-0-1', '5 Days'],
      'hi',
      scope
    );

    expect(map).toEqual({ 'After Food': 'खाने के बाद', '5 Days': '5 दिन' });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("uses the doctor's remembered translation, scoped to that doctor and clinic", async () => {
    const calls: Call[] = [];
    db.select.mockReturnValue(
      chain(
        [
          {
            id: 'row-1',
            sourceHash: hashPhrase('apply on the rash'),
            translatedText: 'चकत्ते पर लगाएँ',
          },
        ],
        calls
      )
    );

    const map = await PrescriptionTranslationService.resolve(
      ['Apply on the rash'],
      'hi',
      scope
    );

    expect(map).toEqual({ 'Apply on the rash': 'चकत्ते पर लगाएँ' });
    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(bindsValue(where, 'clinic-1')).toBe(true);
    expect(bindsValue(where, 'doctor-1')).toBe(true);
    expect(db.insert).not.toHaveBeenCalled();
    expect(provider.translateBatch).not.toHaveBeenCalled();
  });

  it('with no provider, prints English and records the phrase as pending for that doctor', async () => {
    const calls: Call[] = [];
    db.insert.mockReturnValue(chain(undefined, calls));

    const map = await PrescriptionTranslationService.resolve(
      ['Apply on the rash'],
      'hi',
      scope
    );

    expect(map).toEqual({});
    expect(insertedRows(calls)).toEqual([
      expect.objectContaining({
        clinicId: 'clinic-1',
        doctorId: 'doctor-1',
        lang: 'hi',
        sourceText: 'Apply on the rash',
        translatedText: null,
        status: 'pending',
      }),
    ]);
  });

  it('saves a provider translation as machine', async () => {
    const calls: Call[] = [];
    db.insert.mockReturnValue(chain(undefined, calls));
    provider.isEnabled.mockReturnValue(true);
    provider.translateBatch.mockResolvedValue(['2 दिन तक धूप से बचें']);

    const map = await PrescriptionTranslationService.resolve(
      ['Avoid sun for 2 days'],
      'hi',
      scope
    );

    expect(map).toEqual({ 'Avoid sun for 2 days': '2 दिन तक धूप से बचें' });
    expect(insertedRows(calls)[0]).toMatchObject({ status: 'machine' });
  });

  it('drops a provider translation that changed a number', async () => {
    const calls: Call[] = [];
    db.insert.mockReturnValue(chain(undefined, calls));
    provider.isEnabled.mockReturnValue(true);
    provider.translateBatch.mockResolvedValue(['3 दिन तक धूप से बचें']);

    const map = await PrescriptionTranslationService.resolve(
      ['Avoid sun for 2 days'],
      'hi',
      scope
    );

    expect(map).toEqual({});
    expect(insertedRows(calls)[0]).toMatchObject({ status: 'pending' });
  });

  it('prints English when the provider fails, without throwing', async () => {
    provider.isEnabled.mockReturnValue(true);
    provider.translateBatch.mockRejectedValue(new Error('429'));

    await expect(
      PrescriptionTranslationService.resolve(['Avoid sun'], 'hi', scope)
    ).resolves.toEqual({});
  });
});

describe('Translations tab', () => {
  it("lists only the signed-in doctor's phrases in their clinic", async () => {
    const calls: Call[] = [];
    db.select
      .mockReturnValueOnce(
        chain([{ id: 'row-1', sourceText: 'Avoid sun' }], calls)
      )
      .mockReturnValueOnce(chain([{ total: 1 }]));

    const result = await PrescriptionTranslationService.listForDoctor(
      scope,
      'hi',
      'pending',
      1,
      20
    );

    expect(result).toMatchObject({ total: 1, pageNumber: 1, pageSize: 20 });
    const where = calls.find((call) => call.method === 'where')?.args[0];
    expect(bindsValue(where, 'clinic-1')).toBe(true);
    expect(bindsValue(where, 'doctor-1')).toBe(true);
    expect(bindsValue(where, 'pending')).toBe(true);
  });

  it("answers 404 for a phrase that isn't the doctor's own", async () => {
    await expect(
      PrescriptionTranslationService.saveManual(scope, 'row-x', 'धूप से बचें')
    ).rejects.toMatchObject({ status: 404 });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects a correction that changes a number', async () => {
    db.select.mockReturnValue(chain([{ sourceText: 'Avoid sun for 2 days' }]));

    await expect(
      PrescriptionTranslationService.saveManual(
        scope,
        'row-1',
        '3 दिन तक धूप से बचें'
      )
    ).rejects.toMatchObject({ status: 422 });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('saves a valid correction as manual', async () => {
    const calls: Call[] = [];
    db.select.mockReturnValue(chain([{ sourceText: 'Avoid sun for 2 days' }]));
    db.update.mockReturnValue(
      chain([{ id: 'row-1', status: 'manual' }], calls)
    );

    await expect(
      PrescriptionTranslationService.saveManual(
        scope,
        'row-1',
        '2 दिन तक धूप से बचें'
      )
    ).resolves.toMatchObject({ status: 'manual' });
    expect(calls.find((call) => call.method === 'set')?.args[0]).toMatchObject({
      translatedText: '2 दिन तक धूप से बचें',
      status: 'manual',
    });
  });
});

describe('print language settings', () => {
  it('stores English as no language, upserting the one row per doctor', async () => {
    const calls: Call[] = [];
    db.insert.mockReturnValue(chain(undefined, calls));
    db.select.mockReturnValue(chain([{ language: null, style: 'regional' }]));

    await expect(
      PrescriptionTranslationService.saveDoctorSettings(
        'doctor-1',
        'en',
        'regional'
      )
    ).resolves.toEqual({ language: 'en', printStyle: 'regional' });
    expect(
      calls.find((call) => call.method === 'values')?.args[0]
    ).toMatchObject({
      doctorId: 'doctor-1',
      prescriptionLanguage: null,
      prescriptionPrintStyle: 'regional',
    });
  });

  it('reads an unset doctor as English, and a chosen language as regional-only by default', async () => {
    await expect(
      PrescriptionTranslationService.getDoctorSettings('doctor-1')
    ).resolves.toEqual({ language: 'en', printStyle: 'regional' });

    db.select.mockReturnValue(chain([{ language: 'hi', style: null }]));
    await expect(
      PrescriptionTranslationService.getDoctorSettings('doctor-1')
    ).resolves.toEqual({ language: 'hi', printStyle: 'regional' });
  });
});

describe('saved PDF language', () => {
  const template = '{{bi "Advice"}}';

  beforeEach(() => {
    db.select.mockReturnValue(chain([{ language: 'hi', style: null }]));
  });

  it("uses the doctor's default when nothing was picked in Preview", async () => {
    const i18n = await PrescriptionTranslationService.forDoctor(
      template,
      {},
      'doctor-1',
      'clinic-1'
    );
    expect(i18n?.lang).toBe('hi');
  });

  it('uses the language picked in Preview over the default', async () => {
    const i18n = await PrescriptionTranslationService.forDoctor(
      template,
      {},
      'doctor-1',
      'clinic-1',
      'ta'
    );
    expect(i18n?.lang).toBe('ta');
    expect(i18n?.map).toEqual({ Advice: 'ஆலோசனை' });
  });

  it('reads a stored prescription language, keeping an explicit English choice', () => {
    expect(toPrescriptionLanguage('en')).toBe('en');
    expect(toPrescriptionLanguage('hi')).toBe('hi');
    expect(toPrescriptionLanguage('xx')).toBeUndefined();
    expect(toPrescriptionLanguage(null)).toBeUndefined();
  });

  it('prints English only when English was picked in Preview', async () => {
    await expect(
      PrescriptionTranslationService.forDoctor(
        template,
        {},
        'doctor-1',
        'clinic-1',
        'en'
      )
    ).resolves.toBeUndefined();
  });
});

describe('available languages', () => {
  it('offers only languages with a dictionary while no provider is on', () => {
    const codes = PrescriptionTranslationService.availableLanguages();
    expect(codes[0]).toBe('en');
    expect(codes).toEqual(expect.arrayContaining(['hi', 'ta', 'ur']));
    expect(codes).not.toContain('brx');
    expect(codes).not.toContain('doi');
  });

  it('offers all 22 once a provider can translate', () => {
    provider.isEnabled.mockReturnValue(true);
    expect(PrescriptionTranslationService.availableLanguages()).toHaveLength(
      23
    );
  });
});

describe('bi helper', () => {
  const render = (source: string, data: object) =>
    handlebars.compile(source)(data);

  it('prints English exactly as a plain expression would when no language is set', () => {
    expect(render('<b>{{bi notes}}</b>', { notes: 'After <Food>' })).toBe(
      render('<b>{{notes}}</b>', { notes: 'After <Food>' })
    );
  });

  it('prints the escaped translation beneath the English', () => {
    const html = render('{{bi notes}}', {
      notes: 'After Food',
      i18n: { lang: 'hi', map: { 'After Food': 'खाने के <बाद>' } },
    });

    expect(html).toBe(
      'After Food<span class="tr" lang="hi" dir="auto">खाने के &lt;बाद&gt;</span>'
    );
  });

  it('prints only the translation in regional mode, and English where there is none', () => {
    const html = render('{{bi a}}|{{bi b}}', {
      a: 'After Food',
      b: 'Apply on the rash',
      i18n: {
        lang: 'hi',
        bilingual: false,
        map: { 'After Food': 'खाने के बाद' },
      },
    });

    expect(html).toBe(
      '<span class="tr-only" lang="hi" dir="auto">खाने के बाद</span>|Apply on the rash'
    );
  });

  it('translates each part of a combined cell, keeping English where a part has no translation', () => {
    const data = { freq: 'Twice a day', days: '5 Days', dose: 'Take 2 puffs' };
    const map = { 'Twice a day': 'दिन में दो बार', '5 Days': '5 दिन' };

    const collect = new Set<string>();
    render('{{biJoin freq days dose " - "}}', { ...data, i18n: { collect } });
    expect([...collect]).toEqual(['Twice a day', '5 Days', 'Take 2 puffs']);

    expect(
      render('{{biJoin freq days dose " - "}}', {
        ...data,
        i18n: { lang: 'hi', bilingual: false, map },
      })
    ).toBe(
      '<span class="tr-only" lang="hi" dir="auto">दिन में दो बार - 5 दिन - Take 2 puffs</span>'
    );
    expect(render('{{biJoin freq days " - "}}', data)).toBe(
      'Twice a day - 5 Days'
    );
  });

  it('leaves the English-prevails note out of a regional-only print', async () => {
    const template =
      '{{#if i18n.bilingual}}{{bi "Translation for patient convenience. The English text prevails."}}{{/if}}{{bi "Advice"}}';

    const regional = await PrescriptionTranslationService.buildI18n(
      template,
      {},
      'hi',
      scope,
      'regional'
    );
    const bilingual = await PrescriptionTranslationService.buildI18n(
      template,
      {},
      'hi',
      scope,
      'bilingual'
    );

    expect(Object.keys(regional.map ?? {})).toEqual(['Advice']);
    expect(Object.keys(bilingual.map ?? {})).toHaveLength(2);
    expect(regional.bilingual).toBe(false);
  });

  it('collects only what the template wraps, never unwrapped fields like the patient name', async () => {
    const i18n = await PrescriptionTranslationService.buildI18n(
      '{{patient.name}} {{bi "Advice"}} {{#each (split advice ",")}}{{bi this}}{{/each}}',
      {
        patient: { name: 'Ravi Kumar' },
        advice: 'Take adequate rest., Drink boiled water.',
      },
      'hi',
      scope
    );

    expect(i18n.map).toEqual({
      Advice: 'सलाह',
      'Take adequate rest.': 'पर्याप्त आराम करें',
      'Drink boiled water.': 'उबला हुआ पानी पिएँ',
    });
    expect(i18n.head).toContain('Noto+Sans+Devanagari');
  });
});

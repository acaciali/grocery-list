import { describe, expect, it } from 'vitest';
import { parseEntry } from './parseEntry';

describe('parseEntry', () => {
  it('leaves a bare name alone', () => {
    expect(parseEntry('milk')).toEqual({ name: 'milk', quantity: null, unit: null });
  });

  it('pulls off a number and a unit, long or short', () => {
    expect(parseEntry('2 gal milk')).toEqual({ name: 'milk', quantity: 2, unit: 'gal' });
    expect(parseEntry('2 gallons of milk')).toEqual({ name: 'milk', quantity: 2, unit: 'gal' });
    expect(parseEntry('1.5 lb chicken breast')).toEqual({
      name: 'chicken breast', quantity: 1.5, unit: 'lb',
    });
  });

  it('handles fractions and mixed numbers', () => {
    expect(parseEntry('1/2 cup sugar')).toEqual({ name: 'sugar', quantity: 0.5, unit: 'cup' });
    expect(parseEntry('1 1/2 cups flour')).toEqual({ name: 'flour', quantity: 1.5, unit: 'cup' });
  });

  it('treats a bare unit as one of them', () => {
    expect(parseEntry('dozen eggs')).toEqual({ name: 'eggs', quantity: 1, unit: 'dozen' });
    expect(parseEntry('bag of rice')).toEqual({ name: 'rice', quantity: 1, unit: 'bag' });
  });

  it('treats a leading article as a quantity word', () => {
    expect(parseEntry('a dozen eggs')).toEqual({ name: 'eggs', quantity: 1, unit: 'dozen' });
  });

  it('keeps a number that is part of the name', () => {
    // Stripping "2" would leave "% milk", so the guard returns the whole string.
    expect(parseEntry('2% milk')).toEqual({ name: '2% milk', quantity: null, unit: null });
  });

  it('keeps the raw text when stripping would leave nothing', () => {
    expect(parseEntry('2 lbs')).toEqual({ name: '2 lbs', quantity: null, unit: null });
    expect(parseEntry('12')).toEqual({ name: '12', quantity: null, unit: null });
  });

  it('leaves non-grocery entries untouched', () => {
    expect(parseEntry("mom's birthday card")).toEqual({
      name: "mom's birthday card", quantity: null, unit: null,
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseEntry('   bread  ')).toEqual({ name: 'bread', quantity: null, unit: null });
  });
});

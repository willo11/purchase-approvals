import { Amount, CURRENCY_USD } from '../../../src/domain/values/Amount';
import { InvalidAmountError } from '../../../src/domain/errors';

describe('Amount value object', () => {
  it('accepts a positive number with up to 2 decimal places', () => {
    expect(Amount.create(10).getValue()).toBe(10);
    expect(Amount.create(0.5).getValue()).toBe(0.5);
    expect(Amount.create(10.25).getValue()).toBe(10.25);
    expect(Amount.create(1234.01).getValue()).toBe(1234.01);
  });

  it('is always USD', () => {
    expect(Amount.create(99).getCurrency()).toBe(CURRENCY_USD);
  });

  it('rejects a zero, negative, or non-number amount', () => {
    expect(() => Amount.create(0)).toThrow(InvalidAmountError);
    expect(() => Amount.create(-5)).toThrow(InvalidAmountError);
    expect(() => Amount.create(NaN)).toThrow(InvalidAmountError);
    expect(() => Amount.create(Infinity)).toThrow(InvalidAmountError);
    expect(() => Amount.create('10')).toThrow(InvalidAmountError);
    expect(() => Amount.create(null)).toThrow(InvalidAmountError);
  });

  it('rejects an amount with more than 2 decimal places', () => {
    expect(() => Amount.create(10.255)).toThrow(InvalidAmountError);
    expect(() => Amount.create(0.001)).toThrow(InvalidAmountError);
  });
});
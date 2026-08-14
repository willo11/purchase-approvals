import { User, DEFAULT_CARGO } from '../../../src/domain/User';
import { Email } from '../../../src/domain/values/Email';
import { EmptyNameError, InvalidEmailError } from '../../../src/domain/errors';

describe('Email value object', () => {
  it('accepts a valid email and normalizes to lowercase', () => {
    const email = Email.create('  Ana@Example.COM ');
    expect(email.toString()).toBe('ana@example.com');
  });

  it('rejects invalid formats', () => {
    expect(() => Email.create('nope')).toThrow(InvalidEmailError);
    expect(() => Email.create('a@b')).toThrow(InvalidEmailError);
    expect(() => Email.create('')).toThrow(InvalidEmailError);
    expect(() => Email.create(null)).toThrow(InvalidEmailError);
    expect(() => Email.create(42)).toThrow(InvalidEmailError);
  });

  it('compares equality by normalized value', () => {
    expect(Email.create('Ana@ex.com').equals(Email.create('ana@ex.com'))).toBe(true);
    expect(Email.create('ana@ex.com').equals(Email.create('bob@ex.com'))).toBe(false);
  });
});

describe('User entity', () => {
  it('builds a User from valid inputs', () => {
    const user = User.create({ name: 'Ana', email: 'ana@example.com', cargo: 'Contadora' });
    expect(user.toPrimitives()).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      cargo: 'Contadora',
    });
  });

  it('applies the default cargo when omitted', () => {
    const user = User.create({ name: 'Ana', email: 'ana@example.com' });
    expect(user.getCargo()).toBe(DEFAULT_CARGO);
    expect(user.toPrimitives().cargo).toBe(DEFAULT_CARGO);
  });

  it('trims name and rejects empty/whitespace-only names', () => {
    expect(User.create({ name: '  Ana  ', email: 'ana@example.com' }).getName()).toBe('Ana');
    expect(() => User.create({ name: '', email: 'ana@example.com' })).toThrow(EmptyNameError);
    expect(() => User.create({ name: '   ', email: 'ana@example.com' })).toThrow(EmptyNameError);
    expect(() => User.create({ name: null, email: 'ana@example.com' })).toThrow(EmptyNameError);
  });

  it('rejects an invalid email on the entity', () => {
    expect(() => User.create({ name: 'Ana', email: 'not-an-email' })).toThrow(InvalidEmailError);
  });
});
import { describe, it, expect } from 'vitest';
import { basenameOf } from './path';

describe('basenameOf', () => {
  it('returns the last component of a unix path', () => {
    expect(basenameOf('/Users/x/Photos')).toBe('Photos');
  });
  it('returns the last component of a windows path', () => {
    expect(basenameOf('C:\\Users\\x\\Photos')).toBe('Photos');
  });
  it('strips a trailing separator before taking the last component', () => {
    expect(basenameOf('/Users/x/Photos/')).toBe('Photos');
    expect(basenameOf('C:\\Users\\x\\Photos\\')).toBe('Photos');
  });
  it('handles a bare name with no separators', () => {
    expect(basenameOf('Photos')).toBe('Photos');
  });
  it('handles a root path by falling back to the original string', () => {
    expect(basenameOf('/')).toBe('/');
  });
});

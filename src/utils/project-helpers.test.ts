import { describe, it, expect } from 'vitest';
import { projectDisplayName } from './project-helpers';
import { DEFAULT_PROJECT_NAME } from '../types/project';

describe('projectDisplayName', () => {
  it('returns the name when valid', () => {
    expect(projectDisplayName('My Project')).toBe('My Project');
  });

  it('trims whitespace from names', () => {
    expect(projectDisplayName('  My Project  ')).toBe('My Project');
  });

  it('returns default name for null', () => {
    expect(projectDisplayName(null)).toBe(DEFAULT_PROJECT_NAME);
  });

  it('returns default name for undefined', () => {
    expect(projectDisplayName(undefined)).toBe(DEFAULT_PROJECT_NAME);
  });

  it('returns default name for empty string', () => {
    expect(projectDisplayName('')).toBe(DEFAULT_PROJECT_NAME);
  });

  it('returns default name for whitespace-only string', () => {
    expect(projectDisplayName('   ')).toBe(DEFAULT_PROJECT_NAME);
  });
});

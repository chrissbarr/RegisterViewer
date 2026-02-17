import { render, screen, fireEvent } from '@testing-library/react';
import { JsonConfigEditor } from './json-config-editor';
import type { RegisterDef } from '../../types/register';

function makeRegister(overrides?: Partial<RegisterDef>): RegisterDef {
  return {
    id: 'reg-1',
    name: 'STATUS',
    width: 8,
    fields: [
      { id: 'f-1', name: 'ENABLE', msb: 0, lsb: 0, type: 'flag' },
      { id: 'f-2', name: 'MODE', msb: 3, lsb: 1, type: 'integer' },
    ],
    ...overrides,
  };
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByRole('textbox');
}

describe('JsonConfigEditor', () => {
  it('populates textarea with register JSON on initial render', () => {
    const reg = makeRegister();
    render(<JsonConfigEditor register={reg} onUpdate={vi.fn()} />);

    const value = getTextarea().value;
    expect(value).not.toBe('');

    const parsed = JSON.parse(value);
    expect(parsed.name).toBe('STATUS');
    expect(parsed.width).toBe(8);
    expect(parsed.fields).toHaveLength(2);
  });

  it('strips id fields from the JSON output', () => {
    const reg = makeRegister();
    render(<JsonConfigEditor register={reg} onUpdate={vi.fn()} />);

    const parsed = JSON.parse(getTextarea().value);
    expect(parsed).not.toHaveProperty('id');
    for (const field of parsed.fields) {
      expect(field).not.toHaveProperty('id');
    }
  });

  it('updates textarea when register prop changes', () => {
    const reg1 = makeRegister({ name: 'REG_A' });
    const reg2 = makeRegister({ id: 'reg-2', name: 'REG_B' });
    const onUpdate = vi.fn();

    const { rerender } = render(<JsonConfigEditor register={reg1} onUpdate={onUpdate} />);
    expect(JSON.parse(getTextarea().value).name).toBe('REG_A');

    rerender(<JsonConfigEditor register={reg2} onUpdate={onUpdate} />);
    expect(JSON.parse(getTextarea().value).name).toBe('REG_B');
  });

  it('calls onUpdate with sanitized register when Apply JSON is clicked', () => {
    const reg = makeRegister();
    const onUpdate = vi.fn();
    render(<JsonConfigEditor register={reg} onUpdate={onUpdate} />);

    // The textarea already has valid JSON from the register, so just click Apply
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updated = onUpdate.mock.calls[0][0] as RegisterDef;
    expect(updated.name).toBe('STATUS');
    expect(updated.id).toBe('reg-1'); // preserves original id
  });

  it('shows error for invalid JSON', () => {
    const reg = makeRegister();
    render(<JsonConfigEditor register={reg} onUpdate={vi.fn()} />);

    fireEvent.change(getTextarea(), { target: { value: '{invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));

    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
  });

  it('shows error when JSON is not an object', () => {
    const reg = makeRegister();
    render(<JsonConfigEditor register={reg} onUpdate={vi.fn()} />);

    fireEvent.change(getTextarea(), { target: { value: '"just a string"' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));

    expect(screen.getByText('JSON must be an object')).toBeInTheDocument();
  });

  it('applies user edits via Apply JSON', () => {
    const reg = makeRegister();
    const onUpdate = vi.fn();
    render(<JsonConfigEditor register={reg} onUpdate={onUpdate} />);

    // Modify the JSON in the textarea
    const modified = { ...JSON.parse(getTextarea().value), name: 'EDITED' };
    fireEvent.change(getTextarea(), { target: { value: JSON.stringify(modified) } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updated = onUpdate.mock.calls[0][0] as RegisterDef;
    expect(updated.name).toBe('EDITED');
    expect(updated.id).toBe('reg-1');
  });

  it('shows validation errors for invalid register definition', () => {
    const reg = makeRegister();
    render(<JsonConfigEditor register={reg} onUpdate={vi.fn()} />);

    // Set width to 0 which fails validation (must be 1-256)
    const invalid = { ...JSON.parse(getTextarea().value), width: 0 };
    fireEvent.change(getTextarea(), { target: { value: JSON.stringify(invalid) } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));

    expect(screen.getByText(/Register width must be between/)).toBeInTheDocument();
  });

  it('clears error when register prop changes', () => {
    const reg1 = makeRegister({ name: 'REG_A' });
    const reg2 = makeRegister({ id: 'reg-2', name: 'REG_B' });
    const onUpdate = vi.fn();

    const { rerender } = render(<JsonConfigEditor register={reg1} onUpdate={onUpdate} />);

    // Trigger an error
    fireEvent.change(getTextarea(), { target: { value: '{bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));
    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();

    // Switch register — error should clear
    rerender(<JsonConfigEditor register={reg2} onUpdate={onUpdate} />);
    expect(screen.queryByText(/Invalid JSON/)).not.toBeInTheDocument();
  });
});

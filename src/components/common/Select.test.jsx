import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Select from './Select';

const OPTS = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
  { value: '', label: 'System Default' },
];

function setup(props = {}) {
  const onChange = vi.fn();
  render(<Select value="b" onChange={onChange} options={OPTS} {...props} />);
  return { onChange };
}

describe('Select', () => {
  it('shows the label of the selected value', () => {
    setup();
    expect(screen.getByRole('button')).toHaveTextContent('Banana');
  });

  it('is closed initially (no listbox)', () => {
    setup();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opens the menu on click and lists all options', () => {
    setup();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('marks the current value as selected', () => {
    setup();
    fireEvent.click(screen.getByRole('button'));
    const selected = screen.getByRole('option', { selected: true });
    expect(selected).toHaveTextContent('Banana');
  });

  it('calls onChange with the option value and closes', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('option', { name: 'Apple' }));
    expect(onChange).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('handles the empty-string value option', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('option', { name: 'System Default' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('closes on Escape', () => {
    setup();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on outside click', () => {
    setup();
    fireEvent.click(screen.getByRole('button'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

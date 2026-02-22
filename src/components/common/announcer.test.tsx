import { render, screen, act } from '@testing-library/react';
import { AnnouncerProvider, useAnnounce } from './announcer';

function TestAnnouncer({ message, politeness }: { message: string; politeness?: 'polite' | 'assertive' }) {
  const announce = useAnnounce();
  return (
    <button onClick={() => announce(message, { politeness })}>
      Announce
    </button>
  );
}

function renderWithProvider(ui: React.ReactElement) {
  return render(<AnnouncerProvider>{ui}</AnnouncerProvider>);
}

describe('AnnouncerProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders polite and assertive live regions', () => {
    renderWithProvider(<div>child</div>);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('announces a polite message', async () => {
    renderWithProvider(<TestAnnouncer message="Copied to clipboard" />);

    await act(async () => {
      screen.getByText('Announce').click();
      // Allow requestAnimationFrame to fire
      vi.advanceTimersByTime(16);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Copied to clipboard');
  });

  it('announces an assertive message', async () => {
    renderWithProvider(<TestAnnouncer message="Error occurred" politeness="assertive" />);

    await act(async () => {
      screen.getByText('Announce').click();
      vi.advanceTimersByTime(16);
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Error occurred');
  });

  it('clears messages after 5 seconds', async () => {
    renderWithProvider(<TestAnnouncer message="Temporary message" />);

    await act(async () => {
      screen.getByText('Announce').click();
      vi.advanceTimersByTime(16);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Temporary message');

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('throws when useAnnounce is used outside provider', () => {
    function Orphan() {
      useAnnounce();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow('useAnnounce must be used within AnnouncerProvider');
  });
});

import { useState, useCallback, useRef, useEffect } from 'react';
import { Check, Copy } from 'lucide-react';
import { useAnnounce } from './announcer';

interface CopyButtonProps {
  value: string;
  label: string;
  className?: string;
}

export function CopyButton({ value, label, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useAnnounce();

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      announce('Copied to clipboard');
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may fail in non-secure contexts; fail silently
    }
  }, [value, announce]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      title={copied ? 'Copied!' : label}
      className={`p-1 rounded text-gray-400 dark:text-gray-500
        hover:text-gray-600 dark:hover:text-gray-300
        hover:bg-gray-100 dark:hover:bg-gray-700
        transition-colors ${className}`}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

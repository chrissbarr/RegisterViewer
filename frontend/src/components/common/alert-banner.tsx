interface AlertBannerProps {
  variant?: 'amber' | 'red';
  className?: string;
  children: React.ReactNode;
}

const variantStyles = {
  amber:
    'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
  red:
    'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
};

export function AlertBanner({
  variant = 'amber',
  className = '',
  children,
}: AlertBannerProps) {
  return (
    <div
      className={`rounded-md border ${variantStyles[variant]} ${className}`}
    >
      {children}
    </div>
  );
}

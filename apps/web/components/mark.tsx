export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0D1418" />
      <path d="M6 9h7.5L18 16l-4.5 7H6" stroke="#B7EADD" strokeWidth="1.6" fill="none" />
      <circle cx="8" cy="9" r="1.6" fill="#12B8A6" />
      <circle cx="8" cy="23" r="1.6" fill="#829198" />
      <circle cx="14" cy="16" r="1.6" fill="#12B8A6" />
      <rect x="21" y="11.5" width="7" height="9" rx="1.6" stroke="#12B8A6" strokeWidth="1.6" fill="none" />
      <path d="M23 16.1l1.2 1.2 2.2-2.4" stroke="#12B8A6" strokeWidth="1.4" fill="none" />
    </svg>
  );
}

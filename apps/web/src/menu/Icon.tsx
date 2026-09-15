/** Icône Material Design (@mdi/js) en SVG en ligne, couleur du texte. */
export function Icon({ path, size = 22, className }: { path: string; size?: number; className?: string }) {
  return (
    <svg className={className ? `m-ico ${className}` : 'm-ico'} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

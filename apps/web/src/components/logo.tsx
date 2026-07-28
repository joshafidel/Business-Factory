/**
 * The Business Factory mark — a video factory: sawtooth roof, play button,
 * energy bolt. Inline SVG so it stays crisp at any size and needs no asset
 * request. Full-size art lives in public/logo.svg (also the icon source).
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="bf-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f46e5" />
          <stop offset="0.5" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#db2777" />
        </linearGradient>
        <linearGradient id="bf-logo-bolt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
        <mask id="bf-logo-mask">
          <rect width="512" height="512" fill="black" />
          <rect x="128" y="150" width="52" height="130" rx="10" fill="white" />
          <path
            fill="white"
            d="M116 262 L116 226 L200 186 L200 226 L284 186 L284 226 L368 186 L368 262 L396 262 Q412 262 412 278 L412 356 Q412 376 392 376 L120 376 Q100 376 100 356 L100 278 Q100 262 116 262 Z"
          />
          <path
            fill="black"
            d="M225 264 Q225 250 238 257 L308 296 Q320 303 308 310 L238 349 Q225 356 225 342 Z"
          />
        </mask>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#bf-logo-bg)" />
      <rect width="512" height="512" fill="#ffffff" mask="url(#bf-logo-mask)" />
      <path
        fill="url(#bf-logo-bolt)"
        d="M172 64 L128 138 L154 138 L134 196 L196 108 L166 108 L196 64 Z"
      />
      <circle cx="330" cy="106" r="9" fill="#ffffff" opacity="0.9" />
      <circle cx="374" cy="140" r="5" fill="#ffffff" opacity="0.6" />
    </svg>
  );
}

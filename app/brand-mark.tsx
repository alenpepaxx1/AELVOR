// Copyright © 2026 Alen Pepa
export default function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
    <svg viewBox="0 0 44 40" fill="none">
      <path d="M4 33 18.5 7H27L12.5 33H4Z" fill="currentColor"/>
      <path d="M27 7 41 33H32L22.5 15.5 27 7Z" fill="currentColor" opacity=".58"/>
      <path d="M20 25h7l4.4 8H15.5l4.5-8Z" fill="currentColor"/>
    </svg>
  </span>;
}

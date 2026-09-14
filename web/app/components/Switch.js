// A setting that is on or off, as opposed to a row that is selected — see the Booleans block in globals.css.
// Real <input type="checkbox">, visually hidden with .switch-track as its sibling — load-bearing since gm/dev/page.js's server <form action> reads `name` on submit; a <button role="switch"> would post nothing. No "use client", like CheckField.
export default function Switch({ children, className = "", ...rest }) {
  return (
    <label className={`switch-row ${className}`.trim()}>
      <span>{children}</span>
      <input type="checkbox" {...rest} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}

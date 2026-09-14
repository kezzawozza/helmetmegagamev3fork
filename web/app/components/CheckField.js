// A checkbox and its label sentence, on one line. Deliberately NOT "use client": gm/dev/page.js posts checkboxes through a server form action, others use onChange — a directive-free leaf works for both.
// `children` is the label (not a `label` prop) since call sites already write it inline; the rest spreads onto the input untouched.
export default function CheckField({ children, className = "", ...rest }) {
  return (
    <label className={`check-row ${className}`.trim()}>
      <input type="checkbox" {...rest} />
      <span>{children}</span>
    </label>
  );
}

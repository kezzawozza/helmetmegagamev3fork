// An error, said the same way everywhere. DESIGN-SYSTEM.md §2: --danger is for things going wrong, --accent is a fill.
// role="alert" is not optional here — without it a screen reader misses the error.
export default function FormError({ children, className = "" }) {
  if (!children) return null;
  return (
    <p className={`form-error ${className}`.trim()} role="alert">
      {children}
    </p>
  );
}

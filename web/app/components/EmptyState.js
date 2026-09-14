// "There is nothing here" — one shape. EmptyRow spans a table's columns, EmptyState is prose anywhere else; both
// use --muted at --fs-sm, so emptiness never reads as an error.
export default function EmptyState({ children, className = "" }) {
  return <p className={`empty-state ${className}`.trim()}>{children}</p>;
}

// `cols` counts the columns to span — passed explicitly so the dependency is visible at the call site, not hidden
// inside a magic number.
export function EmptyRow({ cols, children }) {
  return (
    <tr>
      <td colSpan={cols} className="empty-state text-center">
        {children}
      </td>
    </tr>
  );
}

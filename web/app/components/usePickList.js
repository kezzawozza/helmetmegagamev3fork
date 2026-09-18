"use client";

// The selection half of CheckPicker: who is ticked, and the two ways a caller
// bulk-ticks people without touching the list itself.
//
// Small on purpose. CheckPicker owns the filter box, Select all, Clear and the
// count, because those are all about the rows it is drawing; this owns only the
// set of ids, so a caller whose selection lives somewhere else (a draft being
// edited, a dialog opened already pointed at something) can skip the hook and
// pass `value`/`onChange` straight in.
//
// Every path hands back a NEW array, never a mutated one —
// react-hooks/immutability is an error in this repo, and a caller may well be
// diffing the array to decide whether Save lights up.
import { useCallback, useMemo, useState } from "react";

export default function usePickList(items, initial = []) {
  const [picked, setPicked] = useState(() => [...initial]);

  const pickedSet = useMemo(() => new Set(picked), [picked]);

  const clear = useCallback(() => setPicked([]), []);

  // For a caller drawing its own rows rather than handing them to CheckPicker
  // — the inactivity report needs three columns and a chip, which a check row
  // cannot say.
  const toggle = useCallback((id) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const set = useCallback((next) => setPicked([...next]), []);

  // "Check everyone in Town" — a one-shot union by
  // predicate rather than a live filter, so the selection stays editable
  // afterwards. Unions, so two of these in a row add up.
  const checkWhere = useCallback(
    (predicate) => {
      setPicked((prev) => [...new Set([...prev, ...items.filter(predicate).map((i) => i.id)])]);
    },
    [items],
  );

  return { picked, pickedSet, set, clear, toggle, checkWhere, count: picked.length };
}

// "Has this stream already sent that row?", with a bound on how much it remembers. A high-water mark alone is wrong here: `seq` is a Postgres sequence, allocated in order but neither committed nor fanned out in order, so a row can arrive late.
// Two generations rather than one growing Set: when the live one fills it becomes the spare and a fresh one takes over, capping memory at about 2 × max. Forgetting early is cheap — the browser keys its own Map on seq and treats a repeat as a no-op — so this exists to keep the wire quiet, not for correctness.
function makeSeenSeqs(max = 1000) {
  if (!Number.isInteger(max) || max < 1) throw new TypeError("makeSeenSeqs needs a positive integer");
  let live = new Set();
  let spare = new Set();
  return {
    has(key) {
      return live.has(key) || spare.has(key);
    },
    add(key) {
      live.add(key);
      if (live.size >= max) {
        spare = live;
        live = new Set();
      }
    },
    get size() {
      return live.size + spare.size;
    },
  };
}

module.exports = { makeSeenSeqs };

// Number helpers that copy Python's behaviour where JavaScript's defaults differ and a result is compared or shown.

/** Python's round(): halves go to the even neighbour (12.5 -> 12, 13.5 -> 14). */
export function pyRound(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

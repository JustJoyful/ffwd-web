// Result helpers shared by the checker modules (training/env/checker.py `_result` and `_add`).

/**
 * @typedef {{ field: string, expected: unknown, actual: unknown, ok: boolean }} Check
 * @typedef {{ passed: boolean, checks: Check[], measurements: Record<string, unknown>, error: string | null }} CheckResult
 */

/**
 * @param {Check[]} checks
 * @param {Record<string, unknown>} measurements
 * @param {string | null} [error]
 * @returns {CheckResult}
 */
export function result(checks, measurements, error = null) {
  return {
    passed: error === null && checks.every((c) => c.ok),
    checks,
    measurements,
    error,
  };
}

/** Append one check; `ok` is coerced to a boolean. */
export function add(checks, field, expected, actual, ok) {
  checks.push({ field, expected, actual, ok: Boolean(ok) });
}

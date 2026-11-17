// A Policy that replaces the model: it returns the given assistant texts in order. Used by the unit tests and by
// the Plan C end-to-end tests, where headless Chromium has no WebGPU. When the script runs out it answers with an
// empty reply, which the loop treats as an invalid turn, so an over-long conversation still ends within the budget.

/**
 * @typedef {{ role: "system" | "user" | "assistant", content: string }} Message
 * @typedef {(messages: Message[]) => Promise<string>} Policy
 */

/**
 * @param {string[]} steps assistant replies, in order
 * @returns {Policy & { calls: Message[][] }} `calls` holds a copy of the conversation shown at each call
 */
export function scriptedPolicy(steps) {
  const queue = [...steps];
  /** @type {Message[][]} */
  const calls = [];
  const policy = async (messages) => {
    calls.push(messages.map((m) => ({ ...m })));
    return queue.shift() ?? "";
  };
  return Object.assign(policy, { calls });
}

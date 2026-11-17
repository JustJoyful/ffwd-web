// Runtime validators compiled from the pinned JSON Schemas in protocol/schemas (WEB_ARCHITECTURE §2).
// A model action or a measured result is rejected at the boundary instead of being trusted by shape.
// shortcut: Ajv compiles at runtime with new Function; fine while the site has no strict CSP, switch to
// ajv standalone (build-time) if Plan D adds one.
import Ajv2020 from "ajv/dist/2020.js";
import action from "../../../protocol/schemas/action.schema.json";
import check from "../../../protocol/schemas/check.schema.json";
import probe from "../../../protocol/schemas/probe.schema.json";
import spec from "../../../protocol/schemas/spec.schema.json";

// The schemas are draft 2020-12 and reference each other by relative $id ("spec", "spec#/$defs/id").
// strict:false because the schemas carry annotation keywords outside the strict vocabulary.
const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const s of [spec, probe, check, action]) ajv.addSchema(s);

/** @typedef {{ ok: boolean, errors: string[] }} Validation */

/** @param {{ $id: string }} s a schema added above */
function compile(s) {
  const fn = ajv.getSchema(s.$id);
  return (x) => {
    const ok = fn(x) === true;
    const errors = ok
      ? []
      : (fn.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`);
    return { ok, errors };
  };
}

/** @type {(x: unknown) => Validation} */
export const validateAction = compile(action);
/** @type {(x: unknown) => Validation} */
export const validateSpec = compile(spec);
/** @type {(x: unknown) => Validation} */
export const validateProbe = compile(probe);
/** @type {(x: unknown) => Validation} */
export const validateCheck = compile(check);

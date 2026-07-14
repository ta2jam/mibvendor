import { createHash } from "node:crypto";

export class CanonicalJsonError extends TypeError {
  constructor(message, location) {
    super(`${location}: ${message}`);
    this.name = "CanonicalJsonError";
  }
}

function assertUnicode(value, location) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new CanonicalJsonError("lone high surrogate is not valid I-JSON", location);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalJsonError("lone low surrogate is not valid I-JSON", location);
    }
  }
}

function serialize(value, location, ancestors) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    assertUnicode(value, location);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalJsonError("non-finite numbers are not valid JSON", location);
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new CanonicalJsonError(`unsupported ${typeof value} value`, location);
  }
  if (ancestors.has(value)) throw new CanonicalJsonError("cyclic structures are not JSON", location);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value).filter((key) => key !== "length");
      if (ownKeys.some((key) => typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key))) {
        throw new CanonicalJsonError("arrays cannot contain named or symbol properties", location);
      }
      if (ownKeys.length !== value.length) {
        throw new CanonicalJsonError("arrays cannot contain out-of-range properties", location);
      }
      const items = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new CanonicalJsonError("sparse arrays are not valid JSON values", `${location}[${index}]`);
        items.push(serialize(value[index], `${location}[${index}]`, ancestors));
      }
      return `[${items.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError("only plain JSON objects are supported", location);
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      throw new CanonicalJsonError("symbol properties are not valid JSON", location);
    }
    const keys = ownKeys.sort();
    const properties = [];
    for (const key of keys) {
      assertUnicode(key, `${location}.<key>`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new CanonicalJsonError("accessors and non-enumerable properties are not JSON data", `${location}.${key}`);
      }
      properties.push(`${JSON.stringify(key)}:${serialize(descriptor.value, `${location}.${key}`, ancestors)}`);
    }
    return `{${properties.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeJson(value) {
  return serialize(value, "$", new Set());
}

export function canonicalJsonBytes(value) {
  return Buffer.from(canonicalizeJson(value), "utf8");
}

export function canonicalJsonSha256(value) {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

function withoutRootField(document, field) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new CanonicalJsonError("digest projection requires a JSON object", "$");
  }
  if (!Object.hasOwn(document, field)) {
    throw new CanonicalJsonError(`digest projection is missing ${field}`, "$");
  }
  const omitted = Object.getOwnPropertyDescriptor(document, field);
  if (!omitted.enumerable || !Object.hasOwn(omitted, "value")) {
    throw new CanonicalJsonError(`${field} must be an enumerable JSON value`, `$.${field}`);
  }
  const projection = Object.create(null);
  for (const key of Reflect.ownKeys(document)) {
    if (key === field) continue;
    Object.defineProperty(projection, key, Object.getOwnPropertyDescriptor(document, key));
  }
  return projection;
}

export function sourceSnapshotDigest(document) {
  return canonicalJsonSha256(withoutRootField(document, "snapshot_id"));
}

export function canonicalModuleDigest(document) {
  return canonicalJsonSha256(withoutRootField(document, "canonical_sha256"));
}

export function dataReleaseDigest(document) {
  return canonicalJsonSha256(withoutRootField(document, "manifest_sha256"));
}

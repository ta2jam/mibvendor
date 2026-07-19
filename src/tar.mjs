const BLOCK_SIZE = 512;

function writeAscii(target, offset, length, value) {
  if (!/^[\x00\x20-\x7e]*$/u.test(value)) throw new TypeError("TAR header values must be ASCII");
  const bytes = Buffer.from(value, "ascii");
  if (bytes.length > length) throw new RangeError(`TAR header value exceeds ${length} bytes`);
  bytes.copy(target, offset);
}

function writeOctal(target, offset, length, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("TAR numeric fields must be non-negative safe integers");
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length >= length) throw new RangeError(`TAR numeric value exceeds ${length} bytes`);
  writeAscii(target, offset, length, `${encoded}\0`);
}

function headerFor(name, size) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,98}$/u.test(name)) throw new TypeError("TAR entry name is unsafe or too long");
  const header = Buffer.alloc(BLOCK_SIZE);
  writeAscii(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeAscii(header, 257, 6, "ustar\0");
  writeAscii(header, 263, 2, "00");
  writeAscii(header, 265, 32, "mibvendor");
  writeAscii(header, 297, 32, "mibvendor");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const encodedChecksum = checksum.toString(8).padStart(6, "0");
  writeAscii(header, 148, 8, `${encodedChecksum}\0 `);
  return header;
}

export function createTar(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("TAR requires at least one entry");
  const seen = new Set();
  const chunks = [];
  for (const entry of entries) {
    if (!entry || typeof entry.name !== "string") throw new TypeError("TAR entries require a name");
    if (seen.has(entry.name)) throw new TypeError(`Duplicate TAR entry ${entry.name}`);
    seen.add(entry.name);
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes ?? "");
    chunks.push(headerFor(entry.name, bytes.length), bytes);
    const padding = (BLOCK_SIZE - (bytes.length % BLOCK_SIZE)) % BLOCK_SIZE;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(BLOCK_SIZE * 2));
  return Buffer.concat(chunks);
}

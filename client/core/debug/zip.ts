// Debug captures use stored ZIP entries with ASCII filenames. The browser joins the parts into a Blob.

const table = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value;
});

function checksum(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function storedZip(files: readonly (readonly [string, Uint8Array<ArrayBuffer>])[]): Uint8Array<ArrayBuffer>[] {
  const records: Uint8Array<ArrayBuffer>[] = [], directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0, directoryBytes = 0;
  for (const [name, data] of files) {
    const path = Uint8Array.from(name, (c) => c.charCodeAt(0)), local = new Uint8Array(30 + path.length), central = new Uint8Array(46 + path.length);
    const header = new DataView(local.buffer), entry = new DataView(central.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 10, true);
    header.setUint16(12, 0x21, true); // The DOS date for January 1, 1980.
    header.setUint32(14, checksum(data), true);
    header.setUint32(18, data.byteLength, true);
    header.setUint32(22, data.byteLength, true);
    header.setUint16(26, path.length, true);
    local.set(path, 30);
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 10, true);
    central.set(local.subarray(4, 30), 6);
    entry.setUint32(42, offset, true);
    central.set(path, 46);
    records.push(local, data);
    directory.push(central);
    offset += local.length + data.byteLength;
    directoryBytes += central.length;
  }
  const end = new Uint8Array(22), footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, files.length, true);
  footer.setUint16(10, files.length, true);
  footer.setUint32(12, directoryBytes, true);
  footer.setUint32(16, offset, true);
  return [...records, ...directory, end];
}

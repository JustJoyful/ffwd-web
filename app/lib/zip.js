// A minimal ZIP writer for the frames result: one zip of the numbered pictures, built in the browser. Files are STORED
// (not compressed): the pictures are PNG or JPEG already, so deflate would cost time and gain almost nothing.
// shortcut: classic ZIP (no ZIP64), so at most 65,535 files and under 4 GiB in total; zipBlob throws past that, and a
// job that large would need ZIP64 (or splitting into several zips).

const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 (the checksum a zip stores for each file). @param {Uint8Array} bytes */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {{ name: string, data: Uint8Array }[]} files
 * @param {Date} [when] the modification time written for every file
 * @returns {Blob} application/zip
 */
export function zipBlob(files, when = new Date()) {
  if (files.length > 0xffff) throw new Error("too many files for one zip");
  const time =
    (when.getHours() << 11) |
    (when.getMinutes() << 5) |
    (when.getSeconds() >> 1);
  const date =
    ((Math.max(when.getFullYear(), 1980) - 1980) << 9) |
    ((when.getMonth() + 1) << 5) |
    when.getDate();
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // flags: the name is UTF-8
    local.setUint16(8, 0, true); // method 0 = stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // no extra field
    parts.push(new Uint8Array(local.buffer), nameBytes, data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true); // version made by
    c.setUint16(6, 20, true); // version needed
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nameBytes.length, true);
    // extra, comment, disk number, internal and external attributes stay 0
    c.setUint32(42, offset, true); // where this file's local header starts
    central.push(new Uint8Array(c.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
    if (offset > 0xffffffff) throw new Error("too large for one zip");
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); // entries on this disk
  end.setUint16(10, files.length, true); // entries in total
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true); // where the central directory starts
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
    type: "application/zip",
  });
}

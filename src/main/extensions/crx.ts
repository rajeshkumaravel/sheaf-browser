import { readFileSync } from 'node:fs'

/**
 * A .crx file is a small header followed by a plain ZIP archive. Electron only
 * loads *unpacked* extensions, so we strip the header and unzip the rest.
 *
 * Layout:
 *   CRX3: "Cr24" | version(4) | headerLen(4) | header(headerLen) | ZIP
 *   CRX2: "Cr24" | version(4) | pubKeyLen(4) | sigLen(4) | pubKey | sig | ZIP
 *
 * We don't verify the signature — Electron can't use it, and these are extensions
 * the developer chose to load. Returns the ZIP portion as a Buffer.
 */
export function crxToZip(crxPath: string): Buffer {
  const buf = readFileSync(crxPath)

  // A bare .zip (some "extensions" are shipped unpacked-in-a-zip) — pass through.
  if (buf.readUInt32BE(0) === 0x504b0304) return buf

  if (buf.subarray(0, 4).toString('ascii') !== 'Cr24') {
    throw new Error('Not a CRX file (missing Cr24 magic)')
  }

  const version = buf.readUInt32LE(4)
  let zipStart: number
  if (version === 3) {
    const headerLen = buf.readUInt32LE(8)
    zipStart = 12 + headerLen
  } else if (version === 2) {
    const pubKeyLen = buf.readUInt32LE(8)
    const sigLen = buf.readUInt32LE(12)
    zipStart = 16 + pubKeyLen + sigLen
  } else {
    throw new Error(`Unsupported CRX version ${version}`)
  }

  if (zipStart >= buf.length) throw new Error('CRX header is malformed')
  return buf.subarray(zipStart)
}

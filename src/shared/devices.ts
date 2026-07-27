/** Device-simulation presets. CSS dimensions + DPR + a representative UA. */

export interface DevicePreset {
  id: string
  label: string
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
  userAgent: string
}

const IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const IPADOS =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36'

export const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'iphone-15', label: 'iPhone 15', width: 393, height: 852, deviceScaleFactor: 3, mobile: true, userAgent: IOS },
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, deviceScaleFactor: 2, mobile: true, userAgent: IOS },
  { id: 'pixel-8', label: 'Pixel 8', width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true, userAgent: ANDROID },
  { id: 'galaxy-s20', label: 'Galaxy S20', width: 360, height: 800, deviceScaleFactor: 3, mobile: true, userAgent: ANDROID },
  { id: 'ipad', label: 'iPad', width: 820, height: 1180, deviceScaleFactor: 2, mobile: true, userAgent: IPADOS },
  { id: 'ipad-pro', label: 'iPad Pro 11"', width: 834, height: 1194, deviceScaleFactor: 2, mobile: true, userAgent: IPADOS }
]

/**
 * User-added devices live in settings and are merged with the built-ins.
 * Registered here so both main (for emulation) and the renderer (for the
 * dropdown) resolve an id the same way — a custom id must never silently fall
 * back to desktop.
 */
let customDevices: DevicePreset[] = []

export function setCustomDevices(list: DevicePreset[]): void {
  customDevices = list
}

export function allDevices(): DevicePreset[] {
  return [...DEVICE_PRESETS, ...customDevices]
}

export function findDevice(id: string | null): DevicePreset | null {
  return id ? (allDevices().find((d) => d.id === id) ?? null) : null
}

export function isBuiltIn(id: string): boolean {
  return DEVICE_PRESETS.some((d) => d.id === id)
}

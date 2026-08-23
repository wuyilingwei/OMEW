import { describe, expect, it } from 'vitest'
import {
  constrainCropRect,
  createCropPreset,
  createFreeCropRect,
  normalizeCropRect,
  type CropRect,
} from '../web/src/utils/imageProcessing'

describe('normalized crop contract', () => {
  it('provides an unconstrained full-image crop', () => {
    expect(createFreeCropRect()).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('normalizes and clamps rectangles to the source image', () => {
    expect(normalizeCropRect({ x: 0.9, y: -0.2, width: -0.4, height: 1.8 })).toEqual({
      x: 0.5, y: 0, width: 0.4, height: 1,
    })
  })

  it('creates aspect-ratio presets and preserves their ratio at the edges', () => {
    expect(createCropPreset(16 / 9)).toEqual({ x: 0, y: 0.21875, width: 1, height: 0.5625 })
    const constrained = constrainCropRect({ x: 0.8, y: 0.8, width: 0.5, height: 0.5 }, 1)
    expect(constrained.x + constrained.width).toBeLessThanOrEqual(1)
    expect(constrained.y + constrained.height).toBeLessThanOrEqual(1)
    expect(constrained.width / constrained.height).toBeCloseTo(1)
  })

  it('keeps small valid rectangles usable', () => {
    const rect: CropRect = normalizeCropRect({ x: 0, y: 0, width: 0, height: 0 })
    expect(rect.width).toBeGreaterThanOrEqual(0.01)
    expect(rect.height).toBeGreaterThanOrEqual(0.01)
  })
})

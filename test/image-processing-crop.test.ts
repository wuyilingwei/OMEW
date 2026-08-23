import { describe, expect, it } from 'vitest'
import {
  constrainCropRect,
  createCropPreset,
  createFreeCropRect,
  hasMeaningfulCrop,
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
    expect(createCropPreset(16 / 9, 3 / 2)).toEqual({ x: 0, y: 0.078125, width: 1, height: 0.84375 })
    expect((1 * (3 / 2)) / 0.84375).toBeCloseTo(16 / 9)
    const squarePreset = createCropPreset(1, 3 / 2)
    expect(squarePreset.x).toBeCloseTo(1 / 6)
    expect(squarePreset.width).toBeCloseTo(2 / 3)
    expect(squarePreset.height).toBe(1)
    expect(((2 / 3) * (3 / 2)) / 1).toBeCloseTo(1)
    const constrained = constrainCropRect({ x: 0.8, y: 0.8, width: 0.5, height: 0.5 }, 16 / 9, 3 / 2)
    expect(constrained.x + constrained.width).toBeLessThanOrEqual(1)
    expect(constrained.y + constrained.height).toBeLessThanOrEqual(1)
    expect((constrained.width * (3 / 2)) / constrained.height).toBeCloseTo(16 / 9)
  })

  it('keeps small valid rectangles usable', () => {
    const rect: CropRect = normalizeCropRect({ x: 0, y: 0, width: 0, height: 0 })
    expect(rect.width).toBeGreaterThanOrEqual(0.01)
    expect(rect.height).toBeGreaterThanOrEqual(0.01)
  })

  it('does not treat an explicit full-image crop as an edit', () => {
    expect(hasMeaningfulCrop()).toBe(false)
    expect(hasMeaningfulCrop({ x: 0, y: 0, width: 1, height: 1 })).toBe(false)
    expect(hasMeaningfulCrop({ x: 0, y: 0, width: 0.99, height: 1 })).toBe(true)
  })
})

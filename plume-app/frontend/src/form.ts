export interface FormState {
  sourceId: number
  metId: number
  stackHeight: number
  emission: number
  stackDia: number
  exitV: number
  stackT: number
  windFrom: number
  windSpeed: number
  stability: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  ambientT: number
  pressure: number
  background: number
  bgGradient: boolean
  bgSlopeEast: number
  bgSlopeNorth: number
  bgRectEmin: number
  bgRectEmax: number
  bgRectNmin: number
  bgRectNmax: number
  useRise: boolean
  parameterization: 'briggs_rural' | 'power_law'
  ay: number
  py: number
  az: number
  pz: number
  downwindExtent: number
  crosswindExtent: number
  upwindExtent: number
  nx: number
  ny: number
  calmThreshold: number
}

export const DEFAULT_FORM: FormState = {
  sourceId: 1,
  metId: 1,
  stackHeight: 120,
  emission: 50,
  stackDia: 4,
  exitV: 18,
  stackT: 410,
  windFrom: 270,
  windSpeed: 6,
  stability: 'D',
  ambientT: 293.15,
  pressure: 1013,
  background: 15,
  bgGradient: false,
  bgSlopeEast: 1,
  bgSlopeNorth: 0,
  bgRectEmin: -10000,
  bgRectEmax: 10000,
  bgRectNmin: -10000,
  bgRectNmax: 10000,
  useRise: false,
  parameterization: 'briggs_rural',
  ay: 0.22,
  py: 1,
  az: 0.16,
  pz: 1,
  downwindExtent: 6000,
  crosswindExtent: 2000,
  upwindExtent: 300,
  nx: 121,
  ny: 81,
  calmThreshold: 1,
}

export type InputFrame = {
  throttle: number
  steer: number
  brake: number
  boost: boolean
}

export const emptyInput = (): InputFrame => ({
  throttle: 0,
  steer: 0,
  brake: 0,
  boost: false,
})

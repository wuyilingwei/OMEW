// error codes come from the /api/* contract's {error: "CODE"} shape
export class ApiRequestError extends Error {
  code: string
  status: number

  constructor(code: string, status: number) {
    super(code)
    this.code = code
    this.status = status
  }
}

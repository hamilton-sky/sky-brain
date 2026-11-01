// An error a route throws to answer with `{"error": {code, message, field?, rule?}}`.
export interface HttpErrorExtra {
  field?: string;
  rule?: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: HttpErrorExtra;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: HttpErrorExtra = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

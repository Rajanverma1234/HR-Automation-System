export class AppError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const badRequest = (message) => new ApiError(400, message);
export const notFound = (message = 'Not found') => new ApiError(404, message);
